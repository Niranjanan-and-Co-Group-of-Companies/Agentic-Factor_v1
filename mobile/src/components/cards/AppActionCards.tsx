// A one-time job's steps in the customer's apps, waiting for "Do it" — messages are shown exactly as they
// will go out — and the offer to make a job a mission that runs by itself.

import type { CommandAction } from '@contracts';
import { StyleSheet, View } from 'react-native';

import { ConnectorBadge } from '@/components/cards/ConnectorBadge';
import { AppText, Button, Card } from '@/components/ui';
import { radius, space, useColors } from '@/theme';

export function ConfirmPlanCard({ action, used, busy, onApprove, onDecline }: {
  action: CommandAction; used?: boolean; busy?: boolean; onApprove: () => void; onDecline: () => void;
}) {
  const c = useColors();
  const steps = action.steps ?? [];
  const decided = used || !!action.resolved;
  return (
    <Card>
      <AppText weight="700">{action.summary}</AppText>
      <View style={{ gap: space.sm }}>
        {steps.map((step, i) => (
          <View key={i} style={{ gap: space.xs }}>
            <View style={styles.stepRow}>
              <AppText size="sm" tone="muted">{i + 1}.</AppText>
              <ConnectorBadge toolkit={step.toolkit} />
              <AppText size="sm" style={{ flex: 1 }}>{step.what}</AppText>
            </View>
            {step.exact && step.preview && step.preview.length > 0 ? (
              <View style={[styles.preview, { backgroundColor: c.bgSecondary, borderColor: c.border }]}>
                {step.preview.map(p => (
                  <AppText key={p.label} size="sm" selectable>
                    <AppText size="sm" tone="muted">{p.label[0].toUpperCase() + p.label.slice(1)}: </AppText>{p.value}
                  </AppText>
                ))}
              </View>
            ) : null}
          </View>
        ))}
      </View>
      {decided ? (
        <AppText weight="600" tone={action.resolved === 'skipped' ? 'muted' : 'emerald'}>{action.resolved === 'skipped' ? 'Not done' : '✓ Approved'}</AppText>
      ) : (
        <>
          <View style={styles.buttons}>
            <Button label="Do it" loading={busy} onPress={onApprove} />
            <Button label="Not now" variant="ghost" disabled={busy} onPress={onDecline} />
          </View>
          {steps.some(s => s.exact) ? <AppText size="xs" tone="muted">Messages go out exactly as shown.</AppText> : null}
        </>
      )}
    </Card>
  );
}

export function OfferMissionCard({ action, used, busy, onAccept, onDecline }: {
  action: CommandAction; used?: boolean; busy?: boolean; onAccept: () => void; onDecline: () => void;
}) {
  const decided = used || !!action.resolved;
  return (
    <Card>
      <AppText weight="700">Make this a mission{action.label ? ` that runs ${action.label}` : ''}?</AppText>
      <AppText size="sm" tone="secondary">It happens by itself, so you don’t have to ask each time. You’ll see its plan before anything runs.</AppText>
      {decided ? (
        <AppText weight="600" tone={action.resolved === 'skipped' ? 'muted' : 'emerald'}>{action.resolved === 'skipped' ? 'Not now' : '✓ Making it a mission'}</AppText>
      ) : (
        <View style={styles.buttons}>
          <Button label="Yes, make it a mission" loading={busy} onPress={onAccept} />
          <Button label="No thanks" variant="ghost" disabled={busy} onPress={onDecline} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  preview: { borderWidth: 1, borderRadius: radius.md, padding: space.sm, gap: 2, marginLeft: space.lg },
  buttons: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', alignItems: 'center' },
});
