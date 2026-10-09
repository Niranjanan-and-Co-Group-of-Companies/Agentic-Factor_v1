import { describe, it, expect } from 'vitest';
import { criticInputView, withPipelineHistory } from '../pipeline-context';

describe('withPipelineHistory', () => {
  it('keeps the previous output on top and adds every earlier output by role', () => {
    const out = withPipelineHistory('{"brand":"Dot & Key","posts":12}', [
      { role: 'Researcher - Minimalist', output: '{"brand":"Minimalist","posts":10}' },
      { role: 'Researcher - The Derma Co', output: '{"brand":"The Derma Co","posts":8}' },
    ]);
    const parsed = JSON.parse(out);
    expect(parsed.brand).toBe('Dot & Key');
    expect(Object.keys(parsed._pipeline)).toEqual(['Researcher - Minimalist', 'Researcher - The Derma Co']);
    expect(parsed._pipeline['Researcher - Minimalist'].posts).toBe(10);
  });

  it('leaves the first hop and non-object outputs unchanged', () => {
    expect(withPipelineHistory('{"a":1}', [])).toBe('{"a":1}');
    expect(withPipelineHistory('[1,2]', [{ role: 'A', output: '{}' }])).toBe('[1,2]');
    expect(withPipelineHistory('plain text', [{ role: 'A', output: '{}' }])).toBe('plain text');
  });

  it('keeps non-JSON earlier outputs as text', () => {
    const parsed = JSON.parse(withPipelineHistory('{"b":2}', [{ role: 'Writer', output: 'some text' }]));
    expect(parsed._pipeline.Writer).toBe('some text');
  });

  it('drops the oldest outputs first when the history is too large', () => {
    const big = JSON.stringify({ blob: 'x'.repeat(40_000) });
    const parsed = JSON.parse(withPipelineHistory('{"c":3}', [
      { role: 'Oldest', output: big },
      { role: 'Middle', output: big },
      { role: 'Newest', output: '{"small":true}' },
    ]));
    expect(Object.keys(parsed._pipeline)).toEqual(['Middle', 'Newest']);
  });
});

describe('criticInputView', () => {
  it('shows every earlier part, not just the start of the previous output', () => {
    const input = withPipelineHistory(JSON.stringify({ brand: 'Dot & Key', notes: 'x'.repeat(3000) }), [
      { role: 'Researcher - Minimalist', output: '{"brand":"Minimalist"}' },
      { role: 'Researcher - The Derma Co', output: '{"brand":"The Derma Co"}' },
    ]);
    const view = criticInputView(input);
    expect(view).toContain('Dot & Key');
    expect(view).toContain('From earlier agent "Researcher - Minimalist"');
    expect(view).toContain('"brand":"The Derma Co"');
  });

  it('falls back to the first 1500 characters for ordinary input', () => {
    expect(criticInputView('{"a":"' + 'y'.repeat(3000) + '"}')).toHaveLength(1500);
    expect(criticInputView('plain')).toBe('plain');
  });
});

describe('withPipelineHistory merges earlier fields', () => {
  it('makes earlier agents\' top-level fields directly readable, previous agent winning on clashes', () => {
    const parsed = JSON.parse(withPipelineHistory('{"slack_summary":{"messages":0},"status":"completed"}', [
      { role: 'GitHub Reader', output: '{"github_summary":{"commits":2},"status":"done"}' },
    ]));
    expect(parsed.github_summary.commits).toBe(2);
    expect(parsed.slack_summary.messages).toBe(0);
    expect(parsed.status).toBe('completed');
    expect(parsed._pipeline['GitHub Reader'].github_summary.commits).toBe(2);
  });
});
