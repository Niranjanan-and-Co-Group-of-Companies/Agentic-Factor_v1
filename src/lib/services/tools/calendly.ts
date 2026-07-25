import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const CALENDLY_BASE = 'https://api.calendly.com';

async function getApiKey(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'calendly')
    .single();
  return data?.access_token ?? null;
}

function noKeyError() {
  return {
    error: 'Calendly API key not connected. Please add your Calendly Personal Access Token in the Connectors page.',
    connector_required: true,
    provider: 'calendly',
  };
}

async function calendlyGet(path: string, apiKey: string) {
  const res = await fetch(`${CALENDLY_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.title || `HTTP ${res.status}`);
  return data;
}

// get_event_types — list available booking types (e.g. "15-Minute Demo", "30-Minute Call")
async function getEventTypesTool({ tenantId }: ToolExecutionContext) {
  const apiKey = await getApiKey(tenantId);
  if (!apiKey) return noKeyError();

  try {
    const me = await calendlyGet('/users/me', apiKey);
    const userUri = me.resource?.uri;
    if (!userUri) return { error: 'Could not resolve Calendly user URI' };

    const data = await calendlyGet(`/event_types?user=${encodeURIComponent(userUri)}&active=true`, apiKey);
    const types = (data.collection ?? []).map((t: Record<string, any>) => ({
      uri: t.uri,
      name: t.name,
      slug: t.slug,
      duration: t.duration,
      schedulingUrl: t.scheduling_url,
      description: t.description_plain,
    }));

    return { eventTypes: types };
  } catch (err) {
    return { error: `Calendly error: ${(err as Error).message}` };
  }
}

// get_upcoming_meetings — see what's scheduled in a date range
async function getUpcomingMeetingsTool({ tenantId, args }: ToolExecutionContext) {
  const apiKey = await getApiKey(tenantId);
  if (!apiKey) return noKeyError();

  const {
    min_start_time = new Date().toISOString(),
    max_start_time,
    limit = 20,
  } = args as { min_start_time?: string; max_start_time?: string; limit?: number };

  try {
    const me = await calendlyGet('/users/me', apiKey);
    const userUri = me.resource?.uri;

    let url = `/scheduled_events?user=${encodeURIComponent(userUri)}&status=active&count=${Math.min(limit, 100)}&min_start_time=${encodeURIComponent(min_start_time)}`;
    if (max_start_time) url += `&max_start_time=${encodeURIComponent(max_start_time)}`;

    const data = await calendlyGet(url, apiKey);
    const events = (data.collection ?? []).map((e: Record<string, any>) => ({
      uri: e.uri,
      name: e.name,
      status: e.status,
      startTime: e.start_time,
      endTime: e.end_time,
      location: e.location?.join_url || e.location?.location || e.location?.type,
    }));

    return { meetings: events, total: data.pagination?.count ?? events.length };
  } catch (err) {
    return { error: `Calendly error: ${(err as Error).message}` };
  }
}

// create_booking_link — generate a one-off scheduling link to embed in an outreach email
async function createBookingLinkTool({ tenantId, args }: ToolExecutionContext) {
  const apiKey = await getApiKey(tenantId);
  if (!apiKey) return noKeyError();

  const { event_type_uri, max_event_count = 1 } = args as {
    event_type_uri: string;
    max_event_count?: number;
  };

  if (!event_type_uri) return { error: 'Missing required argument: event_type_uri' };

  try {
    const me = await calendlyGet('/users/me', apiKey);
    const ownerUri = me.resource?.uri;

    const res = await fetch(`${CALENDLY_BASE}/scheduling_links`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_event_count, owner: ownerUri, owner_type: 'EventType', event_type: event_type_uri }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.title || `HTTP ${res.status}`);

    return {
      bookingUrl: data.resource?.booking_url,
      ownerUri: data.resource?.owner,
    };
  } catch (err) {
    return { error: `Calendly error: ${(err as Error).message}` };
  }
}

registerTool('get_event_types', getEventTypesTool);
registerTool('get_upcoming_meetings', getUpcomingMeetingsTool);
registerTool('create_booking_link', createBookingLinkTool);
