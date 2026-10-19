// A mission update in progress: each step as the server reports it, then the result.

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useEffectEvent, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { Outcome } from '@/lib/actions';
import { supabase } from '@/lib/supabase';
import { space, useColors } from '@/theme';

import { AppText, Card } from '../ui';

export function UpdateCard({ jobId, summary, onDone }: { jobId: string; summary: string; onDone: (outcome: Outcome) => void }) {
  const c = useColors();
  const [steps, setSteps] = useState<string[]>([]);
  const finish = useEffectEvent((o: Outcome) => onDone(o));

  useEffect(() => {
    const channel: RealtimeChannel = supabase
      .channel(`blueprint-update-${jobId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_execution_events', filter: `session_id=eq.${jobId}` }, payload => {
        const row = payload.new as { event_type: string; payload: Record<string, unknown> };
        const p = row.payload ?? {};
        if (row.event_type === 'blueprint_step') setSteps(prev => [...prev, String(p.label ?? p.step)]);
        if (row.event_type === 'blueprint_completed') {
          const credits = typeof p.credits === 'number' && p.credits > 0 ? ` · ${p.credits} credits` : '';
          finish({ ok: true, detail: `${p.versionNumber ? `Saved as version ${p.versionNumber}` : 'Saved'}${credits}` });
        }
        if (row.event_type === 'blueprint_error') finish({ ok: false, error: String(p.message ?? 'The update failed.') });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [jobId]);

  return (
    <Card tone="pending">
      <View style={styles.row}>
        <ActivityIndicator color={c.accent} />
        <View style={{ flex: 1 }}>
          <AppText weight="700">Updating the mission</AppText>
          <AppText size="sm" tone="secondary">{summary}</AppText>
        </View>
      </View>
      {steps.map((s, i) => <AppText key={`${s}-${i}`} size="sm" tone={i === steps.length - 1 ? 'primary' : 'muted'}>{i === steps.length - 1 ? '⋯ ' : '✓ '}{s}</AppText>)}
    </Card>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: space.sm } });
