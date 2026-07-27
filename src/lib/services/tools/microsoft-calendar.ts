import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const GRAPH = 'https://graph.microsoft.com/v1.0/me';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'microsoft')
    .single();
  return data?.access_token ?? null;
}

function noCredError() {
  return { error: 'Microsoft 365 not connected. Please connect Microsoft in the Connectors page.', connector_required: true, provider: 'microsoft', connection_type: 'oauth' };
}

async function graphApi(token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'outlook.timezone="UTC"' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

async function listEventsTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { start_datetime, end_datetime, max_results = 10 } = args as { start_datetime?: string; end_datetime?: string; max_results?: number };
  const now = new Date().toISOString();
  const params = new URLSearchParams({
    $top: String(Math.min(max_results, 50)),
    $orderby: 'start/dateTime',
    startDateTime: start_datetime ?? now,
    endDateTime: end_datetime ?? new Date(Date.now() + 7 * 86400000).toISOString(),
    $select: 'id,subject,start,end,location,attendees,bodyPreview',
  });
  const { status, data } = await graphApi(token, `/calendarView?${params}`);
  if (status >= 400) return { error: `Outlook Calendar error: ${JSON.stringify(data)}` };
  const d = data as { value: Array<Record<string, unknown>> };
  return { events: d.value?.map(e => ({
    id: e.id,
    title: e.subject,
    start: (e.start as Record<string, string>)?.dateTime,
    end: (e.end as Record<string, string>)?.dateTime,
    location: (e.location as Record<string, string>)?.displayName,
    preview: e.bodyPreview,
  })) ?? [] };
}

async function createEventTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { title, start_datetime, end_datetime, description, location, attendees, is_online_meeting = false, timezone = 'UTC' } = args as {
    title: string; start_datetime: string; end_datetime: string; description?: string;
    location?: string; attendees?: string[]; is_online_meeting?: boolean; timezone?: string;
  };
  if (!title || !start_datetime || !end_datetime) return { error: 'title, start_datetime and end_datetime are required' };
  const event: Record<string, unknown> = {
    subject: title,
    start: { dateTime: start_datetime, timeZone: timezone },
    end: { dateTime: end_datetime, timeZone: timezone },
    isOnlineMeeting: is_online_meeting,
  };
  if (description) event.body = { contentType: 'HTML', content: description };
  if (location) event.location = { displayName: location };
  if (attendees?.length) event.attendees = attendees.map(email => ({ emailAddress: { address: email }, type: 'required' }));
  const { status, data } = await graphApi(token, '/events', 'POST', event);
  if (status >= 400) return { error: `Outlook Calendar error: ${JSON.stringify(data)}` };
  const d = data as Record<string, unknown>;
  return { event_id: d.id, web_link: d.webLink, online_meeting_url: (d.onlineMeeting as Record<string, string> | null)?.joinUrl };
}

async function updateEventTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { event_id, title, start_datetime, end_datetime, description, timezone = 'UTC' } = args as {
    event_id: string; title?: string; start_datetime?: string; end_datetime?: string; description?: string; timezone?: string;
  };
  if (!event_id) return { error: 'event_id is required' };
  const patch: Record<string, unknown> = {};
  if (title) patch.subject = title;
  if (description) patch.body = { contentType: 'HTML', content: description };
  if (start_datetime) patch.start = { dateTime: start_datetime, timeZone: timezone };
  if (end_datetime) patch.end = { dateTime: end_datetime, timeZone: timezone };
  const { status, data } = await graphApi(token, `/events/${event_id}`, 'PATCH', patch);
  if (status >= 400) return { error: `Outlook Calendar error: ${JSON.stringify(data)}` };
  return { success: true, event_id };
}

async function checkAvailabilityTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { email_addresses = [], start_datetime, end_datetime, interval_minutes = 60 } = args as {
    email_addresses?: string[]; start_datetime: string; end_datetime: string; interval_minutes?: number;
  };
  if (!start_datetime || !end_datetime) return { error: 'start_datetime and end_datetime are required' };
  const { status, data } = await graphApi(token, '/calendar/getSchedule' as string, 'POST' as string, {
    schedules: email_addresses.length ? email_addresses : ['me'],
    startTime: { dateTime: start_datetime, timeZone: 'UTC' },
    endTime: { dateTime: end_datetime, timeZone: 'UTC' },
    availabilityViewInterval: interval_minutes,
  });
  if (status >= 400) return { error: `Outlook Calendar error: ${JSON.stringify(data)}` };
  return { schedules: (data as { value: unknown[] }).value };
}

registerTool('outlook_list_events', listEventsTool);
registerTool('outlook_create_event', createEventTool);
registerTool('outlook_update_event', updateEventTool);
registerTool('outlook_check_availability', checkAvailabilityTool);
