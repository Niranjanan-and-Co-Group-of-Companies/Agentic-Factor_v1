// ═══════════════════════════════════════════════════════════
// Blueprint edits in the background, one Inngest step per half.
// Rewriting every agent of a five-agent mission in one request ran past the 300s function limit:
// the customer got a 504 and nothing was saved. The update route now queues this job and returns at
// once; the mission page already follows progress through blueprint_step / blueprint_completed /
// blueprint_error events.
// ═══════════════════════════════════════════════════════════
import { inngest } from './client';
import { createServiceClient } from '@/lib/supabase/server';
import type { Mission } from '@/lib/schemas/mission';

interface EditEvent {
  data: {
    missionId: string;
    tenantId: string;
    changeRequest: string;
    jobId: string;
    versionNumber: number | null;
    connectedProviders: string[];
  };
}

export const editBlueprintBackground = inngest.createFunction(
  {
    id: 'edit-blueprint',
    name: 'Edit Blueprint (Background)',
    retries: 0,
    triggers: [{ event: 'mission/blueprint.edit' }],
    // A step killed by the platform's time limit never reaches the catch below; tell the page anyway.
    onFailure: async ({ event, error }: { event: { data: { event?: EditEvent } }; error: Error }) => {
      const d = event.data.event?.data;
      if (!d) return;
      await createServiceClient().from('agent_execution_events').insert({
        session_id: d.jobId, tenant_id: d.tenantId, mission_id: d.missionId, chat_id: d.missionId,
        event_type: 'blueprint_error', payload: { message: error?.message || 'Blueprint update failed — please try again.' },
      });
    },
  },
  async ({ event, step }: { event: EditEvent; step: any }) => {
    const { missionId, tenantId, changeRequest, jobId, versionNumber, connectedProviders } = event.data;
    const supabase = createServiceClient();

    const emit = async (eventType: 'blueprint_step' | 'blueprint_error' | 'blueprint_completed', payload: Record<string, unknown>) => {
      try {
        await supabase.from('agent_execution_events').insert({
          session_id: jobId, tenant_id: tenantId, mission_id: missionId, chat_id: missionId, event_type: eventType, payload,
        });
      } catch { /* non-fatal — the page falls back to polling */ }
    };
    const emitStep = (stepName: string, label: string) => emit('blueprint_step', { step: stepName, label });

    try {
      const current = await step.run('load-mission', async () => {
        const { data, error } = await supabase.from('missions').select('mission_json, title')
          .eq('id', missionId).eq('tenant_id', tenantId).single();
        if (error || !data) throw new Error('Mission not found');
        return data as { mission_json: Mission; title: string };
      });

      const draft = await step.run('draft-edit', async () => {
        const { draftBlueprintEdit } = await import('@/lib/services/intake');
        return draftBlueprintEdit(current.mission_json, changeRequest, tenantId, connectedProviders, emitStep);
      });

      // Each changed agent's script is written in its own call, all in parallel.
      const rewritten = await step.run('rewrite-scripts', async () => {
        const { rewriteAgentScripts } = await import('@/lib/services/intake');
        return rewriteAgentScripts(current.mission_json, draft, changeRequest, tenantId, emitStep);
      });

      const updated = await step.run('validate-edit', async () => {
        const { finalizeBlueprintEdit } = await import('@/lib/services/intake');
        return finalizeBlueprintEdit(current.mission_json, rewritten, tenantId, connectedProviders, emitStep);
      });

      await step.run('save', async () => {
        await emitStep('saving', 'Saving updated blueprint…');
        const { sanitizeTitle } = await import('@/lib/utils/sanitize-title');
        const title = sanitizeTitle(updated.title || current.title);
        const { error } = await supabase.from('missions')
          .update({ mission_json: updated as unknown as Record<string, unknown>, title, updated_at: new Date().toISOString() })
          .eq('id', missionId).eq('tenant_id', tenantId);
        if (error) throw new Error('Failed to save updated blueprint');
        await emit('blueprint_completed', { title, versionNumber });

        const { deductCredits, CREDIT_COSTS } = await import('@/lib/middleware/billing');
        await deductCredits(tenantId, CREDIT_COSTS.llm_call_pro * 3, 'mission_update').catch(() => {});
        const { data: perms } = await supabase.from('tenant_permissions').select('provider').eq('tenant_id', tenantId);
        const { refreshMissionTools } = await import('@/lib/services/tool-registry');
        await refreshMissionTools(tenantId, missionId, (perms ?? []).map((r: { provider: string }) => r.provider)).catch(() => {});
      });

      return { success: true, missionId, versionNumber };
    } catch (err) {
      await emit('blueprint_error', { message: (err as Error).message ?? 'Blueprint update failed' });
      throw err;
    }
  },
);
