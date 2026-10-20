import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, fetchOrder, getSubscription } from '@/lib/services/razorpay';
import { createServiceClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/services/notifications';
import { PLAN_CONFIGS, freePlanFields } from '@/lib/services/plans';
import { ensureBillingRecord } from '@/lib/middleware/billing';

// ============================================================
// POST /api/razorpay/webhook
// Handles Razorpay webhook events for subscription lifecycle.
// All handlers are idempotent — safe to receive duplicate events.
// ============================================================

function resolveLocalPlanName(razorpayPlanId: string): string {
  const envMap: Record<string, string> = {
    [process.env.RAZORPAY_PLAN_INDIVIDUAL        || '']: 'individual',
    [process.env.RAZORPAY_PLAN_INDIVIDUAL_ANNUAL || '']: 'individual_annual',
    [process.env.RAZORPAY_PLAN_PRO               || '']: 'pro',
    [process.env.RAZORPAY_PLAN_PRO_ANNUAL        || '']: 'pro_annual',
    [process.env.RAZORPAY_PLAN_ENTERPRISE        || '']: 'enterprise',
  };
  return envMap[razorpayPlanId] || 'free';
}

// Downgrade a tenant to free plan (used by halted, completed, cancelled)
async function downgradeToFree(tenantId: string, status: string, supabase: ReturnType<typeof createServiceClient>) {
  await supabase.from('tenant_billing').update(freePlanFields(status)).eq('tenant_id', tenantId);
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-razorpay-signature') || '';

    if (!verifyWebhookSignature(rawBody, signature)) {
      console.error('[Razorpay Webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const event = JSON.parse(rawBody);
    const eventType = event.event as string;
    const payload = event.payload;

    console.log(`[Razorpay Webhook] Event: ${eventType}`);

    const supabase = createServiceClient();

    switch (eventType) {

      // ── Subscription activated (first payment successful) ──────
      case 'subscription.activated': {
        const subscription = payload.subscription?.entity;
        if (!subscription) break;

        const tenantId = subscription.notes?.tenant_id;
        if (!tenantId) break;

        const planName = resolveLocalPlanName(subscription.plan_id);
        const config = PLAN_CONFIGS[planName] || PLAN_CONFIGS['free'];
        const isAnnual = config.annual === true;
        // Prefer live quantity from Razorpay over stale notes
        const seatCount = Math.max(1, subscription.quantity ?? parseInt(subscription.notes?.seat_count || '1', 10));
        const creditsToGive = config.credits * (isAnnual ? 12 : 1) * seatCount;
        const periodEnd = subscription.current_end
          ? new Date(subscription.current_end * 1000).toISOString()
          : null;

        // Upsert billing record (handles both new customers and resubscribes)
        const { data: existing } = await supabase
          .from('tenant_billing')
          .select('credits_topup')
          .eq('tenant_id', tenantId)
          .maybeSingle();
        const frozenTopup = existing?.credits_topup ?? 0;

        await supabase.from('tenant_billing').upsert({
          tenant_id: tenantId,
          plan: planName,
          billing_status: 'active',
          razorpay_subscription_id: subscription.id,
          razorpay_customer_id: subscription.customer_id || null,
          razorpay_plan_id: subscription.plan_id,
          credits_remaining: creditsToGive,
          credits_total: creditsToGive,
          credits_topup: frozenTopup, // preserve any existing top-up credits
          credits_used_this_month: 0,
          max_active_missions: config.maxActiveMissions,
          model_tier: config.modelTier,
          max_storage_mb: config.maxStorageMb,
          governance: config.governance,
          is_trial: false,
          billing_period_start: new Date().toISOString(),
          billing_period_end: periodEnd,
          // The plan is billed by the website now, not an app store
          store_platform: null,
          store_product_id: null,
          store_original_transaction_id: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id' });

        const email = subscription.notes?.email;
        if (email) {
          const topupMsg = frozenTopup > 0 ? `\n- 🔓 ${frozenTopup} frozen top-up credits restored!` : '';
          const modelLabel = config.modelTier === 'all' ? 'All AI Models' : config.modelTier === 'mixed' ? 'Flash + Pro Models' : 'Flash Models';
          await sendEmail({
            to: email,
            subject: `🎉 Welcome to Agentic Factor ${planName.replace('_', ' ')}!`,
            body: `Your ${planName} plan is now active.\n\nYou now have:\n- ${creditsToGive.toLocaleString()} credits${isAnnual ? ' (12 months upfront)' : '/month'}\n- ${config.maxActiveMissions} active missions\n- ${modelLabel}${topupMsg}\n\nStart building: https://agenticfactor.io/dashboard`,
          });
        }
        console.log(`[Razorpay Webhook] Tenant ${tenantId} activated on ${planName}`);
        break;
      }

      // ── Subscription charged (monthly/annual renewal — reset credits) ──
      case 'subscription.charged': {
        const subscription = payload.subscription?.entity;
        const payment = payload.payment?.entity;
        if (!subscription) break;

        const tenantId = subscription.notes?.tenant_id;
        if (!tenantId) break;

        // Fetch live subscription from Razorpay to get accurate seat count and period
        let liveSub: any = subscription;
        try { liveSub = await getSubscription(subscription.id); } catch { /* fallback to webhook payload */ }

        const { data: billing } = await supabase
          .from('tenant_billing')
          .select('plan')
          .eq('tenant_id', tenantId)
          .single();

        // Resolve plan from the subscription's own plan_id — avoids the race condition
        // where subscription.charged fires concurrently with subscription.activated and
        // reads 'free' from DB before activated has written the upgraded plan name.
        const resolvedPlan = resolveLocalPlanName(liveSub.plan_id || subscription.plan_id);
        const planName = (resolvedPlan !== 'free' ? resolvedPlan : null) ?? billing?.plan ?? 'individual';
        const config = PLAN_CONFIGS[planName] || PLAN_CONFIGS['individual'];
        // Use live quantity from Razorpay API — authoritative seat count
        const renewalSeats = Math.max(1, liveSub.quantity ?? parseInt(subscription.notes?.seat_count || '1', 10));
        const renewalCredits = config.credits * (config.annual ? 12 : 1) * renewalSeats;
        const periodEnd = liveSub.current_end
          ? new Date(liveSub.current_end * 1000).toISOString()
          : null;

        await supabase.from('tenant_billing').update({
          billing_status: 'active',
          credits_remaining: renewalCredits,
          credits_total: renewalCredits,
          credits_used_this_month: 0,
          billing_period_start: new Date().toISOString(),
          billing_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        }).eq('tenant_id', tenantId);

        // entity_id is a UUID column: the subscription id goes in the payload
        await supabase.from('events').insert({
          tenant_id: tenantId,
          event_type: 'billing.payment_success',
          entity_type: 'billing',
          entity_id: tenantId,
          payload: { subscriptionId: subscription.id, paymentId: payment?.id, amount: payment?.amount, currency: payment?.currency, method: payment?.method, creditsRefilled: renewalCredits, seats: renewalSeats },
        });

        // Send renewal confirmation email
        const email = subscription.notes?.email;
        if (email) {
          await sendEmail({
            to: email,
            subject: '✅ Agentic Factor — Subscription Renewed',
            body: `Your subscription has been renewed successfully.\n\n🪙 ${renewalCredits.toLocaleString()} credits added for the new billing period.\n\nView your usage: https://agenticfactor.io/settings/billing`,
          });
        }
        console.log(`[Razorpay Webhook] Credits reset to ${renewalCredits} for tenant ${tenantId}`);
        break;
      }

      // ── Subscription cancelled ─────────────────────────────────
      case 'subscription.cancelled': {
        const subscription = payload.subscription?.entity;
        if (!subscription) break;

        const tenantId = subscription.notes?.tenant_id;
        if (!tenantId) break;

        // Guard: skip if tenant already upgraded to a different subscription
        const { data: currentBilling } = await supabase
          .from('tenant_billing')
          .select('razorpay_subscription_id, credits_topup')
          .eq('tenant_id', tenantId)
          .single();

        if (
          currentBilling?.razorpay_subscription_id &&
          currentBilling.razorpay_subscription_id !== subscription.id
        ) {
          console.log(`[Razorpay Webhook] Skipping cancel for old sub ${subscription.id} — tenant already on ${currentBilling.razorpay_subscription_id}`);
          break;
        }

        const frozenCredits = currentBilling?.credits_topup ?? 0;

        // If the billing period hasn't ended yet, set cancellation_pending so
        // the tenant keeps access until period end (e.g. UPI autopay deletion).
        // Only downgrade immediately when the period has actually expired.
        const periodEnd = subscription.current_end
          ? new Date(subscription.current_end * 1000)
          : null;
        const periodStillActive = periodEnd && periodEnd > new Date();

        if (periodStillActive) {
          await supabase.from('tenant_billing').update({
            billing_status: 'cancellation_pending',
            billing_period_end: periodEnd!.toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('tenant_id', tenantId);

          const email = subscription.notes?.email;
          if (email) {
            const frozenMsg = frozenCredits > 0
              ? `\n\n🔒 Your ${frozenCredits} top-up credits will be frozen at period end and restored when you resubscribe.`
              : '';
            await sendEmail({
              to: email,
              subject: '⚠️ Agentic Factor Subscription Cancelled',
              body: `Your subscription has been cancelled. You'll retain full access until ${periodEnd!.toLocaleDateString('en-IN')}.${frozenMsg}\n\nResubscribe: https://agenticfactor.io/pricing`,
            });
          }
          console.log(`[Razorpay Webhook] Tenant ${tenantId} cancellation_pending until ${periodEnd!.toISOString()}`);
        } else {
          await downgradeToFree(tenantId, 'cancelled', supabase);

          const email = subscription.notes?.email;
          if (email) {
            const frozenMsg = frozenCredits > 0
              ? `\n\n🔒 Your ${frozenCredits} top-up credits are frozen and will be restored when you resubscribe.`
              : '';
            await sendEmail({
              to: email,
              subject: '⚠️ Agentic Factor Subscription Cancelled',
              body: `Your subscription has been cancelled and you've been moved to the free plan.${frozenMsg}\n\nResubscribe: https://agenticfactor.io/pricing`,
            });
          }
          console.log(`[Razorpay Webhook] Tenant ${tenantId} cancelled → free`);
        }
        break;
      }

      // ── Subscription halted (Razorpay suspended after repeated failures) ──
      case 'subscription.halted': {
        const subscription = payload.subscription?.entity;
        if (!subscription) break;

        const tenantId = subscription.notes?.tenant_id;
        if (!tenantId) break;

        await supabase.from('tenant_billing').update({
          billing_status: 'halted',
          updated_at: new Date().toISOString(),
        }).eq('tenant_id', tenantId);

        const email = subscription.notes?.email;
        if (email) {
          await sendEmail({
            to: email,
            subject: '🚨 Agentic Factor — Subscription Halted',
            body: `Your subscription has been halted due to repeated payment failures. Your plan is still active but new missions may be blocked.\n\nPlease update your payment method immediately: https://agenticfactor.io/settings/billing\n\nIf payment is not resolved, your account will be downgraded to free.`,
          });
        }
        console.log(`[Razorpay Webhook] Tenant ${tenantId} subscription halted`);
        break;
      }

      // ── Subscription completed (reached total_count — extremely rare) ──
      case 'subscription.completed': {
        const subscription = payload.subscription?.entity;
        if (!subscription) break;

        const tenantId = subscription.notes?.tenant_id;
        if (!tenantId) break;

        await downgradeToFree(tenantId, 'completed', supabase);

        const email = subscription.notes?.email;
        if (email) {
          await sendEmail({
            to: email,
            subject: '📋 Agentic Factor — Subscription Completed',
            body: `Your subscription period has ended. You've been moved to the free plan.\n\nRenew your subscription: https://agenticfactor.io/pricing`,
          });
        }
        console.log(`[Razorpay Webhook] Tenant ${tenantId} subscription completed → free`);
        break;
      }

      // ── Subscription resumed (after halted, payment resolved) ──
      case 'subscription.resumed': {
        const subscription = payload.subscription?.entity;
        if (!subscription) break;

        const tenantId = subscription.notes?.tenant_id;
        if (!tenantId) break;

        // Restore active status; credits are restored on next subscription.charged event
        await supabase.from('tenant_billing').update({
          billing_status: 'active',
          updated_at: new Date().toISOString(),
        }).eq('tenant_id', tenantId);

        const email = subscription.notes?.email;
        if (email) {
          await sendEmail({
            to: email,
            subject: '✅ Agentic Factor — Subscription Resumed',
            body: `Your subscription has been resumed successfully. All features are restored.\n\nGo to dashboard: https://agenticfactor.io/dashboard`,
          });
        }
        console.log(`[Razorpay Webhook] Tenant ${tenantId} subscription resumed`);
        break;
      }

      // ── Subscription pending (created but payment not yet collected) ──
      case 'subscription.pending': {
        const subscription = payload.subscription?.entity;
        if (!subscription) break;

        const tenantId = subscription.notes?.tenant_id;
        if (!tenantId) break;

        await supabase.from('tenant_billing').update({
          billing_status: 'pending',
          updated_at: new Date().toISOString(),
        }).eq('tenant_id', tenantId).neq('billing_status', 'active');
        // Only set pending if not already active (avoid overwriting a successful activation)

        console.log(`[Razorpay Webhook] Tenant ${tenantId} subscription pending`);
        break;
      }

      // ── Payment failed ─────────────────────────────────────────
      case 'payment.failed': {
        const payment = payload.payment?.entity;
        if (!payment) break;

        const tenantId = payment.notes?.tenant_id;
        if (!tenantId) break;

        await supabase.from('tenant_billing').update({
          billing_status: 'past_due',
          updated_at: new Date().toISOString(),
        }).eq('tenant_id', tenantId);

        const email = payment.notes?.email || payment.email;
        if (email) {
          await sendEmail({
            to: email,
            subject: '❌ Agentic Factor Payment Failed',
            body: `Your payment of ₹${(payment.amount / 100).toFixed(0)} failed.\n\nReason: ${payment.error_description || 'Unknown'}\n\nPlease update your payment method: https://agenticfactor.io/settings/billing`,
          });
        }
        break;
      }

      // ── Top-up payment captured (one-time credit purchase) ─────
      default:
        if (eventType === 'payment.captured') {
          const payment = payload.payment?.entity;
          if (!payment) break;

          let notes: Record<string, string> = {};
          if (payment.order_id) {
            try {
              const order = await fetchOrder(payment.order_id);
              notes = order.notes || {};
            } catch (err) {
              console.error('[Razorpay Webhook] Could not fetch order for payment', payment.id, err);
            }
          }

          if (notes.type !== 'topup' || !notes.tenant_id || !notes.pack_credits) break;

          const tenantId = notes.tenant_id;
          const packCredits = parseInt(notes.pack_credits, 10);
          const packId = notes.pack_id || 'unknown';

          if (packCredits > 0) {
            // Records the payment and adds its credits together, once per payment (billing_payments).
            // A failure answers 500, so Razorpay sends the event again.
            await ensureBillingRecord(tenantId);
            const { data: granted, error: grantError } = await supabase.rpc('grant_purchase_credits', {
              p_payment_id: `razorpay:${payment.id}`,
              p_tenant_id:  tenantId,
              p_source:     'razorpay',
              p_product:    packId,
              p_credits:    packCredits,
            });
            if (grantError) throw new Error(`Top-up ${payment.id} not credited: ${grantError.message}`);

            if (granted === false) {
              console.log(`[Razorpay Webhook] Top-up ${payment.id} already processed — skipping duplicate`);
              break;
            }

            await supabase.from('events').insert({
              tenant_id: tenantId,
              event_type: 'billing.topup_purchased',
              entity_type: 'billing',
              entity_id: tenantId,
              payload: { paymentId: payment.id, source: 'razorpay', packId, credits: packCredits, amount: payment.amount, currency: payment.currency },
            });

            const email = notes.email;
            if (email) {
              await sendEmail({
                to: email,
                subject: `✅ ${packCredits} Credits Added — Agentic Factor`,
                body: `Your top-up purchase was successful!\n\n🪙 ${packCredits} credits have been added to your account.\n\nThese credits never expire and are preserved even if you cancel your subscription.\n\nView your balance: https://agenticfactor.io/settings/billing`,
              });
            }
            console.log(`[Razorpay Webhook] Top-up: +${packCredits} credits for tenant ${tenantId}`);
          }
        } else {
          console.log(`[Razorpay Webhook] Unhandled event: ${eventType}`);
        }
    }

    return NextResponse.json({ received: true });

  } catch (error) {
    console.error('[Razorpay Webhook] Error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
