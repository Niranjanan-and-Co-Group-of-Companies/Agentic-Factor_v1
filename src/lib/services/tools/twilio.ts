import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

// Credentials stored as "ACCOUNT_SID|AUTH_TOKEN" in access_token
async function getCredentials(tenantId: string): Promise<{ accountSid: string; authToken: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'twilio')
    .single();
  if (!data?.access_token) return null;
  const [accountSid, authToken] = data.access_token.split('|');
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken };
}

function noCredError() {
  return { error: 'Twilio not connected. Please add your Twilio credentials in the Connectors page.', connector_required: true, provider: 'twilio' };
}

async function twilioApi(creds: { accountSid: string; authToken: string }, path: string, params: Record<string, string>) {
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');
  const body = new URLSearchParams(params);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return { status: res.status, data: await res.json() };
}

async function sendSmsTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { to, from, body } = args as { to: string; from: string; body: string };
  if (!to || !from || !body) return { error: 'Missing required arguments: to, from, body' };
  const { status, data } = await twilioApi(creds, '/Messages.json', { To: to, From: from, Body: body });
  if (status >= 400) return { error: `Twilio error: ${(data as Record<string, string>).message}` };
  return { message_sid: (data as Record<string, unknown>).sid, status: (data as Record<string, unknown>).status };
}

async function sendWhatsAppTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { to, from, body } = args as { to: string; from: string; body: string };
  if (!to || !from || !body) return { error: 'Missing required arguments: to, from, body' };
  // WhatsApp numbers use whatsapp: prefix
  const waTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const waFrom = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;
  const { status, data } = await twilioApi(creds, '/Messages.json', { To: waTo, From: waFrom, Body: body });
  if (status >= 400) return { error: `Twilio error: ${(data as Record<string, string>).message}` };
  return { message_sid: (data as Record<string, unknown>).sid, status: (data as Record<string, unknown>).status };
}

async function makeCallTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { to, from, twiml_url, twiml } = args as { to: string; from: string; twiml_url?: string; twiml?: string };
  if (!to || !from) return { error: 'Missing required arguments: to, from' };
  if (!twiml_url && !twiml) return { error: 'Provide either twiml_url or twiml' };
  const params: Record<string, string> = { To: to, From: from };
  if (twiml_url) params.Url = twiml_url;
  if (twiml) params.Twiml = twiml;
  const { status, data } = await twilioApi(creds, '/Calls.json', params);
  if (status >= 400) return { error: `Twilio error: ${(data as Record<string, string>).message}` };
  return { call_sid: (data as Record<string, unknown>).sid, status: (data as Record<string, unknown>).status };
}

registerTool('twilio_send_sms', sendSmsTool);
registerTool('twilio_send_whatsapp', sendWhatsAppTool);
registerTool('twilio_make_call', makeCallTool);
