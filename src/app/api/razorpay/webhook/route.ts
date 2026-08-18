import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/services/razorpay';
import { createServiceClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/services/notifications';

// ============================================================
// POST /api/razorpay/webhook
// Handles Razorpay webhook events for subscription lifecycle.
// Credit-based billing model.
// ============================================================

// Credit-based plan configurations
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
    [process.env.RAZORPAY_PLAN_INDIVIDUAL || '']:        'individual',
    [process.env.RAZORPAY_PLAN_INDIVIDUAL_ANNUAL || '']:  'individual_annual',
    [process.env.RAZORPAY_PLAN_PRO || '']:               'pro',
    [process.env.RAZORPAY_PLAN_PRO_ANNUAL || '']:        'pro_annual',
    [process.env.RAZORPAY_PLAN_ENTERPRISE || '']:        'enterprise',
  };
  return envMap[razorpayPlanId] || 'free';
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

      // ── Subscription activated (first payment successful) ──
      case 'subscription.activated': {
        const subscription = payload.subscription?.entity;
        if (!subscription) break;

        const tenantId = subscription.notes?.tenant_id;
        const planName = resolveLocalPlanName(subscription.plan_id);
        const config = PLAN_CONFIGS[planName] || PLAN_CONFIGS['free'];
        const isAnnual = config.annual === true;
        const seatCount = parseInt(subscription.notes?.seat_count || '1', 10);
        const creditsToGive = config.credits * (isAnnual ? 12 : 1) * seatCount;

        if (tenantId) {
          // Get existing billing record — covers resubscribe (frozen top-up credits)
          // and the edge case where the user paid before ever opening the app
          // (no billing row yet), in which case .update() would silently do nothing.
          const { data: existingBilling } = await supabase
            .from('tenant_billing')
            .select('credits_topup')
            .eq('tenant_id', tenantId)
            .single();
          const frozenTopup = existingBilling?.credits_topup ?? 0;

          // Create a bare free-tier record so the update below has a row to land on
          if (!existingBilling) {
            await supabase.from('tenant_billing').insert({
              tenant_id: tenantId,
              plan: 'free',
              billing_status: 'trialing',
              credits_remaining: 0,
              credits_total: 0,
              credits_topup: 0,
              credits_used_this_month: 0,
              max_active_missions: 1,
              model_tier: 'flash',
              max_storage_mb: 100,
              governance: 'none',
              is_trial: false,
            });
          }

          await supabase
            .from('tenant_billing')
            .update({
              plan: planName,
              billing_status: 'active',
              razorpay_subscription_id: subscription.id,
              razorpay_customer_id: subscription.customer_id || null,
              razorpay_plan_id: subscription.plan_id,
              // Credit-based fields — annual plans get 12 months upfront
              credits_remaining: creditsToGive,
              credits_total: creditsToGive,
              credits_used_this_month: 0,
              // Preserve existing top-up credits (returned on resubscribe)
              // credits_topup is NOT touched — frozen credits come back automatically
              max_active_missions: config.maxActiveMissions,
              model_tier: config.modelTier,
              max_storage_mb: config.maxStorageMb,
              governance: config.governance,
              is_trial: false,
              billing_period_start: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('tenant_id', tenantId);

          const email = subscription.notes?.email;
          if (email) {
            const topupMsg = frozenTopup > 0 ? `\n- 🔓 ${frozenTopup} frozen top-up credits restored!` : '';
            await sendEmail({
              to: email,
              subject: `🎉 Welcome to Agentic Factor ${planName.charAt(0).toUpperCase() + planName.slice(1)}!`,
              body: `Your ${planName} plan is now active.\n\nYou now have:\n- ${config.credits.toLocaleString()} monthly credits\n- ${config.maxActiveMissions} active missions\n- ${config.modelTier === 'all' ? 'All AI Models' : config.modelTier === 'mixed' ? 'Flash + Pro Models' : 'Flash Models'}${topupMsg}\n\nStart building: https://agenticfactor.io/dashboard`,
            });
          }

          console.log(`[Razorpay Webhook] Tenant ${tenantId} upgraded to ${planName}`);
        }
        break;
      }

      // ── Subscription charged (recurring payment — reset credits) ──
      case 'subscription.charged': {
        const subscription = payload.subscription?.entity;
        const payment = payload.payment?.entity;
        if (!subscription) break;

        const tenantId = subscription.notes?.tenant_id;
        if (tenantId) {
          // Get current plan to know credit amount
          const { data: billing } = await supabase
            .from('tenant_billing')
            .select('plan')
            .eq('tenant_id', tenantId)
            .single();

          const planName = billing?.plan || 'individual';
          const config = PLAN_CONFIGS[planName] || PLAN_CONFIGS['individual'];
          const renewalSeats = parseInt(subscription.notes?.seat_count || '1', 10);
          const renewalCredits = config.credits * (config.annual ? 12 : 1) * renewalSeats;

          // Reset credits for new billing cycle
          await supabase
            .from('tenant_billing')
            .update({
              billing_status: 'active',
              credits_remaining: renewalCredits,
              credits_used_this_month: 0,
              billing_period_start: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('tenant_id', tenantId);

          await supabase.from('events').insert({
            tenant_id: tenantId,
            event_type: 'billing.payment_success',
            entity_type: 'billing',
            entity_id: subscription.id,
            payload: { amount: payment?.amount, currency: payment?.currency, method: payment?.method, creditsRefilled: renewalCredits },
          });

          console.log(`[Razorpay Webhook] Credits reset to ${config.credits} for tenant ${tenantId}`);
        }
        break;
      }

      // ── Subscription cancelled ──
      case 'subscription.cancelled': {
        const subscription = payload.subscription?.entity;
        if (!subscription) break;

        const tenantId = subscription.notes?.tenant_id;
        const freeConfig = PLAN_CONFIGS['free'];

        if (tenantId) {
          // Guard against upgrade race: if the tenant has already switched to a
          // new subscription, this cancel event is for the OLD plan. Skip the
          // downgrade so the new plan's subscription.activated webhook wins.
          const { data: currentBilling } = await supabase
            .from('tenant_billing')
            .select('razorpay_subscription_id')
            .eq('tenant_id', tenantId)
            .single();

          if (
            currentBilling?.razorpay_subscription_id &&
            currentBilling.razorpay_subscription_id !== subscription.id
          ) {
            console.log(`[Razorpay Webhook] Skipping cancel for old sub ${subscription.id} — tenant already upgraded to ${currentBilling.razorpay_subscription_id}`);
            break;
          }
          await supabase
            .from('tenant_billing')
            .update({
              plan: 'free',
              billing_status: 'cancelled',
              credits_remaining: 0, // Monthly credits removed
              credits_total: 0,
              // credits_topup is NOT touched — frozen, preserved for resubscribe
              max_active_missions: freeConfig.maxActiveMissions,
              model_tier: freeConfig.modelTier,
              max_storage_mb: freeConfig.maxStorageMb,
              governance: freeConfig.governance,
              is_trial: false,
              updated_at: new Date().toISOString(),
            })
            .eq('tenant_id', tenantId);

          // Get frozen top-up balance for the email
          const { data: billingAfter } = await supabase
            .from('tenant_billing')
            .select('credits_topup')
            .eq('tenant_id', tenantId)
            .single();
          const frozenCredits = billingAfter?.credits_topup ?? 0;

          const email = subscription.notes?.email;
          if (email) {
            const frozenMsg = frozenCredits > 0
              ? `\n\n🔒 You have ${frozenCredits} frozen top-up credits. These will be restored when you resubscribe.`
              : '';
            await sendEmail({
              to: email,
              subject: '⚠️ Agentic Factor Subscription Cancelled',
              body: `Your subscription has been cancelled.\n\nYour monthly credits have been removed.${frozenMsg}\n\nResubscribe to get fresh credits: https://agenticfactor.io/pricing`,
            });
          }

          console.log(`[Razorpay Webhook] Tenant ${tenantId} cancelled`);
        }
        break;
      }

      // ── Payment failed ──
      case 'payment.failed': {
        const payment = payload.payment?.entity;
        if (!payment) break;

        const tenantId = payment.notes?.tenant_id;
        if (tenantId) {
          await supabase
            .from('tenant_billing')
            .update({
              billing_status: 'past_due',
              updated_at: new Date().toISOString(),
            })
            .eq('tenant_id', tenantId);

          const email = payment.notes?.email || payment.email;
          if (email) {
            await sendEmail({
              to: email,
              subject: '❌ Agentic Factor Payment Failed',
              body: `Your payment of ₹${(payment.amount / 100).toFixed(0)} failed.\n\nReason: ${payment.error_description || 'Unknown'}\n\nPlease update your payment method: https://agenticfactor.io/pricing`,
            });
          }
        }
        break;
      }

      default:
        // ── Handle payment.captured for top-up purchases ──
        if (eventType === 'payment.captured') {
          const payment = payload.payment?.entity;
          if (!payment) break;

          const notes = payment.notes || {};
          // Only process top-up payments (not subscription payments)
          if (notes.type !== 'topup' || !notes.tenant_id || !notes.pack_credits) break;

          const tenantId = notes.tenant_id;
          const packCredits = parseInt(notes.pack_credits, 10);
          const packId = notes.pack_id || 'unknown';

          if (packCredits > 0) {
            // Add credits to top-up bucket
            const { data: currentBilling } = await supabase
              .from('tenant_billing')
              .select('credits_topup')
              .eq('tenant_id', tenantId)
              .single();

            const currentTopup = currentBilling?.credits_topup ?? 0;

            await supabase
              .from('tenant_billing')
              .update({
                credits_topup: currentTopup + packCredits,
                updated_at: new Date().toISOString(),
              })
              .eq('tenant_id', tenantId);

            // Log the event
            await supabase.from('events').insert({
              tenant_id: tenantId,
              event_type: 'billing.topup_purchased',
              entity_type: 'billing',
              entity_id: payment.id,
              payload: {
                packId,
                credits: packCredits,
                amount: payment.amount,
                currency: payment.currency,
                newTopupBalance: currentTopup + packCredits,
              },
            });

            // Send confirmation email
            const email = notes.email;
            if (email) {
              await sendEmail({
                to: email,
                subject: `✅ ${packCredits} Credits Added — Agentic Factor`,
                body: `Your top-up purchase was successful!\n\n🪙 ${packCredits} credits have been added to your account.\n\nThese top-up credits never expire and will be preserved even if you cancel your subscription.\n\nView your balance: https://agenticfactor.io/pricing`,
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
