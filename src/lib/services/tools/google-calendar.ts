import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const GCal = 'https://www.googleapis.com/calendar/v3';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'google')
    .single();
  return data?.access_token ?? null;
}

function noCredError() {
  return { error: 'Google not connected. Please connect Google in the Connectors page.', connector_required: true, provider: 'google', connection_type: 'oauth' };
}

async function gcalApi(token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${GCal}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

async function listEventsTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { calendar_id = 'primary', time_min, time_max, max_results = 10, query } = args as {
    calendar_id?: string; time_min?: string; time_max?: string; max_results?: number; query?: string;
  };
  const now = new Date().toISOString();
  const params = new URLSearchParams({
    maxResults: String(Math.min(max_results, 100)),
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: time_min ?? now,
  });
  if (time_max) params.set('timeMax', time_max);
  if (query) params.set('q', query);
  const { status, data } = await gcalApi(token, `/calendars/${encodeURIComponent(calendar_id)}/events?${params}`);
  if (status >= 400) return { error: `Google Calendar error: ${JSON.stringify(data)}` };
  const d = data as Record<string, unknown>;
  return { events: (d.items as Array<Record<string, unknown>> ?? []).map(e => ({
    id: e.id, title: e.summary, start: (e.start as Record<string, string>)?.dateTime ?? (e.start as Record<string, string>)?.date,
    end: (e.end as Record<string, string>)?.dateTime ?? (e.end as Record<string, string>)?.date,
    location: e.location, description: e.description, attendees: e.attendees, status: e.status,
  })) };
}

async function createEventTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { calendar_id = 'primary', title, start_datetime, end_datetime, description, location, attendees, all_day = false, timezone = 'UTC' } = args as {
    calendar_id?: string; title: string; start_datetime: string; end_datetime: string;
    description?: string; location?: string; attendees?: string[]; all_day?: boolean; timezone?: string;
  };
  if (!title || !start_datetime || !end_datetime) return { error: 'title, start_datetime, end_datetime are required' };

  const event: Record<string, unknown> = {
    summary: title,
    start: all_day ? { date: start_datetime.split('T')[0] } : { dateTime: start_datetime, timeZone: timezone },
    end: all_day ? { date: end_datetime.split('T')[0] } : { dateTime: end_datetime, timeZone: timezone },
  };
  if (description) event.description = description;
  if (location) event.location = location;
  if (attendees?.length) event.attendees = attendees.map(email => ({ email }));

  const { status, data } = await gcalApi(token, `/calendars/${encodeURIComponent(calendar_id)}/events`, 'POST', event);
  if (status >= 400) return { error: `Google Calendar error: ${JSON.stringify(data)}` };
  const d = data as Record<string, unknown>;
  return { event_id: d.id, html_link: d.htmlLink, title, start: start_datetime, end: end_datetime };
}

async function updateEventTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { calendar_id = 'primary', event_id, title, start_datetime, end_datetime, description, location, timezone = 'UTC' } = args as {
    calendar_id?: string; event_id: string; title?: string; start_datetime?: string;
    end_datetime?: string; description?: string; location?: string; timezone?: string;
  };
  if (!event_id) return { error: 'event_id is required' };
  const patch: Record<string, unknown> = {};
  if (title) patch.summary = title;
  if (description !== undefined) patch.description = description;
  if (location !== undefined) patch.location = location;
  if (start_datetime) patch.start = { dateTime: start_datetime, timeZone: timezone };
  if (end_datetime) patch.end = { dateTime: end_datetime, timeZone: timezone };
  const { status, data } = await gcalApi(token, `/calendars/${encodeURIComponent(calendar_id)}/events/${event_id}`, 'PATCH', patch);
  if (status >= 400) return { error: `Google Calendar error: ${JSON.stringify(data)}` };
  return { success: true, event_id };
}

async function deleteEventTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { calendar_id = 'primary', event_id } = args as { calendar_id?: string; event_id: string };
  if (!event_id) return { error: 'event_id is required' };
  const { status } = await gcalApi(token, `/calendars/${encodeURIComponent(calendar_id)}/events/${event_id}`, 'DELETE');
  if (status >= 400) return { error: `Google Calendar error: failed to delete event` };
  return { success: true, event_id };
}

async function checkAvailabilityTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { calendars = ['primary'], time_min, time_max, timezone = 'UTC' } = args as {
    calendars?: string[]; time_min: string; time_max: string; timezone?: string;
  };
  if (!time_min || !time_max) return { error: 'time_min and time_max are required (ISO 8601 format)' };
  const { status, data } = await gcalApi(token, '/freeBusy', 'POST', {
    timeMin: time_min, timeMax: time_max, timeZone: timezone,
    items: calendars.map(id => ({ id })),
  });
  if (status >= 400) return { error: `Google Calendar error: ${JSON.stringify(data)}` };
  const d = data as Record<string, unknown>;
  const calendarsData = d.calendars as Record<string, { busy: Array<{ start: string; end: string }> }>;
  const busy = Object.entries(calendarsData).flatMap(([, cal]) => cal.busy ?? []);
  return { time_min, time_max, busy_slots: busy, is_free: busy.length === 0 };
}

async function findFreeSlotTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { duration_minutes = 60, search_from, search_days = 7, working_hours_start = 9, working_hours_end = 18, timezone = 'UTC' } = args as {
    duration_minutes?: number; search_from?: string; search_days?: number;
    working_hours_start?: number; working_hours_end?: number; timezone?: string;
  };
  const from = new Date(search_from ?? new Date().toISOString());
  const to = new Date(from);
  to.setDate(to.getDate() + search_days);

  const { status, data } = await gcalApi(token, '/freeBusy', 'POST', {
    timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: timezone, items: [{ id: 'primary' }],
  });
  if (status >= 400) return { error: `Google Calendar error: ${JSON.stringify(data)}` };
  const d = data as Record<string, unknown>;
  const busy = ((d.calendars as Record<string, { busy: Array<{ start: string; end: string }> }>)?.primary?.busy ?? [])
    .map(b => ({ start: new Date(b.start), end: new Date(b.end) }));

  const slots: Array<{ start: string; end: string }> = [];
  const cursor = new Date(from);
  while (cursor < to && slots.length < 5) {
    cursor.setHours(working_hours_start, 0, 0, 0);
    const dayEnd = new Date(cursor);
    dayEnd.setHours(working_hours_end, 0, 0, 0);
    while (cursor < dayEnd && slots.length < 5) {
      const slotEnd = new Date(cursor.getTime() + duration_minutes * 60000);
      if (slotEnd > dayEnd) break;
      const conflict = busy.some(b => cursor < b.end && slotEnd > b.start);
      if (!conflict) slots.push({ start: cursor.toISOString(), end: slotEnd.toISOString() });
      cursor.setTime(cursor.getTime() + 30 * 60000);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return { free_slots: slots, duration_minutes, timezone };
}

registerTool('google_calendar_list_events', listEventsTool);
registerTool('google_calendar_create_event', createEventTool);
registerTool('google_calendar_update_event', updateEventTool);
registerTool('google_calendar_delete_event', deleteEventTool);
registerTool('google_calendar_check_availability', checkAvailabilityTool);
registerTool('google_calendar_find_free_slot', findFreeSlotTool);
