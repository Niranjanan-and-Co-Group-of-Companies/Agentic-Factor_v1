import { describe, it, expect } from 'vitest';
import { withPipelineHistory } from '../pipeline-context';

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
