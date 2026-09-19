import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, fetchOrder, getSubscription } from '@/lib/services/razorpay';
import { createServiceClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/services/notifications';

// ============================================================
// POST /api/razorpay/webhook
// Handles Razorpay webhook events for subscription lifecycle.
// All handlers are idempotent — safe to receive duplicate events.
// ============================================================

// Single source of truth for plan configs (mirrors billing.ts PLAN_DEFAULTS)
const PLAN_CONFIGS: Record<string, {
  credits: number; maxActiveMissions: number; modelTier: string;
  maxStorageMb: number; governance: string; annual?: boolean; basePlan?: string;
}> = {
  free:               { credits: 30,    maxActiveMissions: 1,     modelTier: 'flash',  maxStorageMb: 100,       governance: 'none' },
  individual:         { credits: 1000,  maxActiveMissions: 5,     modelTier: 'mixed',  maxStorageMb: 10_240,    governance: 'basic_memory' },
  individual_annual:  { credits: 1000,  maxActiveMissions: 5,     modelTier: 'mixed',  maxStorageMb: 10_240,    governance: 'basic_memory', annual: true, basePlan: 'individual' },
  pro:                { credits: 2500,  maxActiveMissions: 50,    modelTier: 'all',    maxStorageMb: 102_400,   governance: 'rbac' },
  pro_annual:         { credits: 2500,  maxActiveMissions: 50,    modelTier: 'all',    maxStorageMb: 102_400,   governance: 'rbac', annual: true, basePlan: 'pro' },
  enterprise:         { credits: 99999, maxActiveMissions: 99999, modelTier: 'custom', maxStorageMb: 1_048_576, governance: 'full_audit' },
};

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
  const freeConfig = PLAN_CONFIGS['free'];
  await supabase.from('tenant_billing').update({
    plan: 'free',
    billing_status: status,
    credits_remaining: 0,
    credits_total: 0,
    max_active_missions: freeConfig.maxActiveMissions,
    model_tier: freeConfig.modelTier,
    max_storage_mb: freeConfig.maxStorageMb,
    governance: freeConfig.governance,
    is_trial: false,
    updated_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId);
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

        const planName = billing?.plan || 'individual';
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

        await supabase.from('events').insert({
          tenant_id: tenantId,
          event_type: 'billing.payment_success',
          entity_type: 'billing',
          entity_id: subscription.id,
          payload: { amount: payment?.amount, currency: payment?.currency, method: payment?.method, creditsRefilled: renewalCredits, seats: renewalSeats },
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

        await downgradeToFree(tenantId, 'cancelled', supabase);
        const frozenCredits = currentBilling?.credits_topup ?? 0;

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
            // Idempotent grant via DB function — skips if payment_id already processed
            const { data: grantResult } = await supabase.rpc('grant_topup_idempotent', {
              p_tenant_id:  tenantId,
              p_payment_id: payment.id,
              p_credits:    packCredits,
            });

            if (grantResult === false) {
              console.log(`[Razorpay Webhook] Top-up ${payment.id} already processed — skipping duplicate`);
              break;
            }

            // Log the event (grant_topup_idempotent already checked for this, so this insert is safe)
            await supabase.from('events').insert({
              tenant_id: tenantId,
              event_type: 'billing.topup_purchased',
              entity_type: 'billing',
              entity_id: payment.id,
              payload: { packId, credits: packCredits, amount: payment.amount, currency: payment.currency },
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
