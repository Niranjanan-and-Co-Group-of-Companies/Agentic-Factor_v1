import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// POST /api/email/inbound — SendGrid Inbound Parse Webhook
//
// Receives emails sent to mission-specific addresses like:
//   mission-abc123@agents.agenticfactor.io
//
// Flow:
// 1. Extract sender, recipient, subject, body from webhook payload
// 2. Look up mission by inbound_email address
// 3. Verify sender is in allowed_senders whitelist
// 4. If valid, create an event + trigger agent processing
// 5. If invalid, silently ignore (prevent misuse/spam)
// ============================================================

interface InboundEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  envelope: string;
}

export async function POST(request: NextRequest) {
  try {
    // SendGrid sends multipart/form-data
    const formData = await request.formData();

    const from = extractEmail(formData.get('from') as string || '');
    const to = formData.get('to') as string || '';
    const subject = formData.get('subject') as string || '';
    const text = formData.get('text') as string || '';
    const html = formData.get('html') as string || '';

    // Try envelope for more reliable sender/recipient
    let envelopeFrom = from;
    let envelopeTo = to;
    try {
      const envelope = JSON.parse(formData.get('envelope') as string || '{}');
      if (envelope.from) envelopeFrom = extractEmail(envelope.from);
      if (envelope.to?.length) envelopeTo = envelope.to[0];
    } catch { /* ignore envelope parse errors */ }

    const recipientEmail = extractEmail(envelopeTo).toLowerCase();
    const senderEmail = envelopeFrom.toLowerCase();

    if (!recipientEmail || !senderEmail) {
      console.warn('[Inbound Email] Missing from/to:', { from, to });
      return NextResponse.json({ status: 'ignored', reason: 'missing_fields' });
    }

    const supabase = createServiceClient();

    // ── Find mission by inbound email address ──
    const { data: mission } = await supabase
      .from('missions')
      .select('id, tenant_id, title, allowed_senders, status')
      .eq('inbound_email', recipientEmail)
      .single();

    if (!mission) {
      console.warn(`[Inbound Email] No mission found for: ${recipientEmail}`);
      return NextResponse.json({ status: 'ignored', reason: 'no_matching_mission' });
    }

    // ── Verify sender is whitelisted ──
    const allowedSenders: string[] = mission.allowed_senders || [];
    const senderAllowed = allowedSenders.some(
      (allowed: string) => allowed.toLowerCase() === senderEmail
    );

    if (!senderAllowed) {
      console.warn(`[Inbound Email] Sender ${senderEmail} not whitelisted for mission ${mission.id}`);

      // Log the rejected email as an event for audit
      await supabase.from('events').insert({
        tenant_id: mission.tenant_id,
        event_type: 'email.rejected',
        entity_type: 'mission',
        entity_id: mission.id,
        payload: {
          from: senderEmail,
          to: recipientEmail,
          subject,
          reason: 'sender_not_whitelisted',
        },
      });

      return NextResponse.json({ status: 'rejected', reason: 'sender_not_whitelisted' });
    }

    // ── Mission must be active to receive emails ──
    if (!['active', 'building', 'paused'].includes(mission.status)) {
      return NextResponse.json({ status: 'ignored', reason: 'mission_not_active' });
    }

    // ── Create event for the agent to process ──
    await supabase.from('events').insert({
      tenant_id: mission.tenant_id,
      event_type: 'email.received',
      entity_type: 'mission',
      entity_id: mission.id,
      payload: {
        from: senderEmail,
        to: recipientEmail,
        subject,
        body: text || stripHtml(html),
        receivedAt: new Date().toISOString(),
      },
    });

    // ── Trigger agent processing (if mission is active) ──
    if (mission.status === 'active') {
      try {
        // Find the first agent in this mission and create a proposed_action for it
        const { data: agents } = await supabase
          .from('agents')
          .select('id')
          .eq('mission_id', mission.id)
          .order('agent_index', { ascending: true })
          .limit(1);

        if (agents?.[0]) {
          await supabase.from('proposed_actions').insert({
            tenant_id: mission.tenant_id,
            mission_id: mission.id,
            agent_id: agents[0].id,
            action_type: 'process_email',
            description: `Process incoming email from ${senderEmail}: "${subject}"`,
            payload: {
              from: senderEmail,
              subject,
              body: text || stripHtml(html),
            },
            risk_level: 'low',
            status: 'auto_approved', // Email processing is pre-approved since sender is whitelisted
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          });
        }
      } catch (err) {
        console.error('[Inbound Email] Failed to trigger agent:', err);
      }
    }

    console.log(`[Inbound Email] ✅ Processed email from ${senderEmail} for mission ${mission.title}`);
    return NextResponse.json({ status: 'processed', missionId: mission.id });

  } catch (error) {
    console.error('[Inbound Email] Error:', error);
    // Always return 200 to prevent SendGrid from retrying
    return NextResponse.json({ status: 'error' }, { status: 200 });
  }
}

// ── Utility: Extract email from "Name <email>" format ──
function extractEmail(str: string): string {
  const match = str.match(/<([^>]+)>/);
  return match ? match[1] : str.trim();
}

// ── Utility: Strip HTML tags for plain text fallback ──
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
