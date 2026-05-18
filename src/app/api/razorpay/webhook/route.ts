import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, resolvePlanName } from '@/lib/services/razorpay';
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
  maxStorageMb: number; governance: string;
}> = {
  free:       { credits: 30,    maxActiveMissions: 1,     modelTier: 'flash',  maxStorageMb: 100,       governance: 'none' },
  individual: { credits: 1000,  maxActiveMissions: 5,     modelTier: 'mixed',  maxStorageMb: 10_240,    governance: 'basic_memory' },
  pro:        { credits: 5000,  maxActiveMissions: 50,    modelTier: 'all',    maxStorageMb: 102_400,   governance: 'rbac' },
  enterprise: { credits: 99999, maxActiveMissions: 99999, modelTier: 'custom', maxStorageMb: 1_048_576, governance: 'full_audit' },
};

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
        const planName = resolvePlanName(subscription.plan_id);
        const config = PLAN_CONFIGS[planName] || PLAN_CONFIGS['free'];

        if (tenantId) {
          await supabase
            .from('tenant_billing')
            .update({
              plan: planName,
              billing_status: 'active',
              razorpay_subscription_id: subscription.id,
              razorpay_customer_id: subscription.customer_id || null,
              razorpay_plan_id: subscription.plan_id,
              // Credit-based fields
              credits_remaining: config.credits,
              credits_total: config.credits,
              credits_used_this_month: 0,
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
            await sendEmail({
              to: email,
              subject: `🎉 Welcome to Agentic Factor ${planName.charAt(0).toUpperCase() + planName.slice(1)}!`,
              body: `Your ${planName} plan is now active.\n\nYou now have:\n- ${config.credits.toLocaleString()} credits/month\n- ${config.maxActiveMissions} active missions\n- ${config.modelTier === 'all' ? 'All AI Models' : config.modelTier === 'mixed' ? 'Flash + Pro Models' : 'Flash Models'}\n\nStart building: https://agenticfactor.io/dashboard`,
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

          // Reset credits for new billing cycle
          await supabase
            .from('tenant_billing')
            .update({
              billing_status: 'active',
              credits_remaining: config.credits,
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
            payload: { amount: payment?.amount, currency: payment?.currency, method: payment?.method, creditsRefilled: config.credits },
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
          await supabase
            .from('tenant_billing')
            .update({
              plan: 'free',
              billing_status: 'cancelled',
              credits_remaining: 0, // No free credits after cancellation
              credits_total: 0,
              max_active_missions: freeConfig.maxActiveMissions,
              model_tier: freeConfig.modelTier,
              max_storage_mb: freeConfig.maxStorageMb,
              governance: freeConfig.governance,
              is_trial: false,
              updated_at: new Date().toISOString(),
            })
            .eq('tenant_id', tenantId);

          const email = subscription.notes?.email;
          if (email) {
            await sendEmail({
              to: email,
              subject: '⚠️ Agentic Factor Subscription Cancelled',
              body: `Your subscription has been cancelled.\n\nYour credits have been removed. Resubscribe to get fresh credits.\n\nhttps://agenticfactor.io/pricing`,
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
        console.log(`[Razorpay Webhook] Unhandled event: ${eventType}`);
    }

    return NextResponse.json({ received: true });

  } catch (error) {
    console.error('[Razorpay Webhook] Error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
