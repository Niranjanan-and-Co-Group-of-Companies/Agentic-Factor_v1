import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { executeMissionBackground, generateBlueprintBackground } from '@/lib/inngest/functions';
import { handleInboundEmail } from '@/lib/inngest/email-functions';

// ═══════════════════════════════════════════════════════════
// /api/inngest — Inngest webhook endpoint
//
// This route is called by Inngest to execute background functions.
// It serves all registered Inngest functions.
// Inngest expects this at /api/inngest (configured in the dashboard).
// ═══════════════════════════════════════════════════════════

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    executeMissionBackground,
    generateBlueprintBackground,
    handleInboundEmail,
  ],
});
