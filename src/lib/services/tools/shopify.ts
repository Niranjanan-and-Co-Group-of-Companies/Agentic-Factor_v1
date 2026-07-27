import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const API_VERSION = '2024-01';

async function getCredentials(tenantId: string): Promise<{ token: string; shop: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'shopify')
    .single();
  if (!data?.access_token) return null;
  try {
    const parsed = JSON.parse(data.access_token) as { apiKey: string; shop: string };
    return { token: parsed.apiKey, shop: parsed.shop };
  } catch { return null; }
}

function noCredError() {
  return { error: 'Shopify not connected. Please add your Shopify credentials in the Connectors page.', connector_required: true, provider: 'shopify', connection_type: 'apikey' };
}

async function shopifyApi(token: string, shop: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}${path}`, {
    method,
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function listProductsTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { limit = 20, status = 'active' } = args as { limit?: number; status?: string };
  const { status: s, data } = await shopifyApi(creds.token, creds.shop, `/products.json?limit=${Math.min(limit, 250)}&status=${status}`);
  if (s >= 400) return { error: `Shopify error: ${JSON.stringify(data)}` };
  const d = data as { products: Array<Record<string, unknown>> };
  return { products: d.products?.map(p => ({ id: p.id, title: p.title, status: p.status, vendor: p.vendor, product_type: p.product_type, price: (p.variants as Array<Record<string, string>>)?.[0]?.price })) ?? [] };
}

async function listOrdersTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { limit = 20, fulfillment_status, financial_status } = args as { limit?: number; fulfillment_status?: string; financial_status?: string };
  let path = `/orders.json?limit=${Math.min(limit, 250)}&status=any`;
  if (fulfillment_status) path += `&fulfillment_status=${fulfillment_status}`;
  if (financial_status) path += `&financial_status=${financial_status}`;
  const { status, data } = await shopifyApi(creds.token, creds.shop, path);
  if (status >= 400) return { error: `Shopify error: ${JSON.stringify(data)}` };
  const d = data as { orders: Array<Record<string, unknown>> };
  return { orders: d.orders?.map(o => ({ id: o.id, name: o.name, email: (o.email as string), total_price: o.total_price, financial_status: o.financial_status, fulfillment_status: o.fulfillment_status, created_at: o.created_at })) ?? [] };
}

async function getOrderTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { order_id } = args as { order_id: string };
  if (!order_id) return { error: 'order_id is required' };
  const { status, data } = await shopifyApi(creds.token, creds.shop, `/orders/${order_id}.json`);
  if (status >= 400) return { error: `Shopify error: ${JSON.stringify(data)}` };
  return { order: (data as { order: unknown }).order };
}

async function createCustomerTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { email, first_name, last_name, phone, tags, note } = args as {
    email: string; first_name?: string; last_name?: string; phone?: string; tags?: string; note?: string;
  };
  if (!email) return { error: 'email is required' };
  const customer: Record<string, unknown> = { email };
  if (first_name) customer.first_name = first_name;
  if (last_name) customer.last_name = last_name;
  if (phone) customer.phone = phone;
  if (tags) customer.tags = tags;
  if (note) customer.note = note;
  const { status, data } = await shopifyApi(creds.token, creds.shop, '/customers.json', 'POST', { customer });
  if (status >= 400) return { error: `Shopify error: ${JSON.stringify(data)}` };
  return { customer_id: (data as { customer: Record<string, unknown> }).customer?.id, email };
}

registerTool('shopify_list_products', listProductsTool);
registerTool('shopify_list_orders', listOrdersTool);
registerTool('shopify_get_order', getOrderTool);
registerTool('shopify_create_customer', createCustomerTool);
