import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { executeMissionBackground, generateBlueprintBackground } from '@/lib/inngest/functions';
import { handleInboundEmail } from '@/lib/inngest/email-functions';
import { generateWelcomeMessages } from '@/lib/inngest/message-cron';
import { executeChatAgent } from '@/lib/inngest/chat-agent-function';
import { editBlueprintBackground } from '@/lib/inngest/blueprint-edit-function';

// ═══════════════════════════════════════════════════════════
// /api/inngest — Inngest webhook endpoint
//
// This route is called by Inngest to execute background functions.
// It serves all registered Inngest functions.
// Inngest expects this at /api/inngest (configured in the dashboard).
// ═══════════════════════════════════════════════════════════

// Each Inngest step is one invocation of this route; an agent step (codegen + sandbox + critic,
// with retries) needs the full budget. executeAgent stops starting new attempts well before it.
// 800s is the most the plan allows: headroom for a long build step, not a budget to plan around.
export const maxDuration = 800;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    executeMissionBackground,
    generateBlueprintBackground,
    handleInboundEmail,
    generateWelcomeMessages,
    executeChatAgent,
    editBlueprintBackground,
  ],
});
