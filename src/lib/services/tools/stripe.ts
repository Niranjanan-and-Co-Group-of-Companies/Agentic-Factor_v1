import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const STRIPE_BASE = 'https://api.stripe.com/v1';

async function getKey(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'stripe')
    .single();
  return data?.access_token ?? null;
}

function noKeyError() {
  return { error: 'Stripe not connected. Please add your Stripe secret key in the Connectors page.', connector_required: true, provider: 'stripe' };
}

async function stripeApi(key: string, path: string, method = 'GET', params?: Record<string, string>) {
  const auth = Buffer.from(`${key}:`).toString('base64');
  const url = `${STRIPE_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function getBalanceTool({ tenantId }: ToolExecutionContext) {
  const key = await getKey(tenantId);
  if (!key) return noKeyError();
  const { status, data } = await stripeApi(key, '/balance');
  if (status >= 400) return { error: `Stripe error: ${(data as Record<string, Record<string, string>>).error?.message}` };
  const available = ((data as Record<string, Record<string, number>[]>).available ?? []).map(b => ({
    amount: b.amount / 100,
    currency: b.currency,
  }));
  return { available };
}

async function createCustomerTool({ tenantId, args }: ToolExecutionContext) {
  const key = await getKey(tenantId);
  if (!key) return noKeyError();
  const { email, name, phone, description } = args as Record<string, string>;
  if (!email) return { error: 'Missing required argument: email' };
  const params: Record<string, string> = { email };
  if (name) params.name = name;
  if (phone) params.phone = phone;
  if (description) params.description = description;
  const { status, data } = await stripeApi(key, '/customers', 'POST', params);
  if (status >= 400) return { error: `Stripe error: ${(data as Record<string, Record<string, string>>).error?.message}` };
  return { customer_id: (data as Record<string, unknown>).id, success: true };
}

async function listSubscriptionsTool({ tenantId, args }: ToolExecutionContext) {
  const key = await getKey(tenantId);
  if (!key) return noKeyError();
  const { customer_id, status = 'active', limit = 10 } = args as { customer_id?: string; status?: string; limit?: number };
  let path = `/subscriptions?status=${status}&limit=${Math.min(limit, 100)}`;
  if (customer_id) path += `&customer=${customer_id}`;
  const { status: httpStatus, data } = await stripeApi(key, path);
  if (httpStatus >= 400) return { error: `Stripe error: ${(data as Record<string, Record<string, string>>).error?.message}` };
  const subs = ((data as Record<string, Record<string, unknown>[]>).data ?? []).map(s => ({
    id: s.id, status: s.status, current_period_end: s.current_period_end,
    customer: s.customer, plan: (s.items as Record<string, unknown[]>)?.data?.[0],
  }));
  return { subscriptions: subs, has_more: (data as Record<string, unknown>).has_more };
}

async function createInvoiceTool({ tenantId, args }: ToolExecutionContext) {
  const key = await getKey(tenantId);
  if (!key) return noKeyError();
  const { customer_id, amount, currency = 'usd', description } = args as { customer_id: string; amount: number; currency?: string; description?: string };
  if (!customer_id || !amount) return { error: 'Missing required arguments: customer_id, amount' };
  // Create invoice item first
  const itemParams: Record<string, string> = { customer: customer_id, amount: String(Math.round(amount * 100)), currency };
  if (description) itemParams.description = description;
  await stripeApi(key, '/invoiceitems', 'POST', itemParams);
  // Then create and finalize invoice
  const { status, data } = await stripeApi(key, '/invoices', 'POST', { customer: customer_id, auto_advance: 'true' });
  if (status >= 400) return { error: `Stripe error: ${(data as Record<string, Record<string, string>>).error?.message}` };
  return { invoice_id: (data as Record<string, unknown>).id, hosted_invoice_url: (data as Record<string, unknown>).hosted_invoice_url };
}

async function searchCustomersTool({ tenantId, args }: ToolExecutionContext) {
  const key = await getKey(tenantId);
  if (!key) return noKeyError();
  const { email } = args as { email: string };
  if (!email) return { error: 'Missing required argument: email' };
  const { status, data } = await stripeApi(key, `/customers/search?query=${encodeURIComponent(`email:'${email}'`)}`);
  if (status >= 400) return { error: `Stripe error: ${(data as Record<string, Record<string, string>>).error?.message}` };
  return { customers: (data as Record<string, unknown>).data };
}

registerTool('stripe_get_balance', getBalanceTool);
registerTool('stripe_create_customer', createCustomerTool);
registerTool('stripe_list_subscriptions', listSubscriptionsTool);
registerTool('stripe_create_invoice', createInvoiceTool);
registerTool('stripe_search_customers', searchCustomersTool);
