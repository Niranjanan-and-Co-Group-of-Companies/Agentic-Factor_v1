import { describe, it, expect } from 'vitest';
import { anthropicText } from '../llm-router';

describe('anthropicText', () => {
  it('skips a leading thinking block', () => {
    expect(anthropicText({ content: [
      { type: 'thinking', text: undefined },
      { type: 'text', text: '```python\nprint(1)\n```' },
    ] })).toBe('```python\nprint(1)\n```');
  });
  it('joins several text blocks in order', () => {
    expect(anthropicText({ content: [{ type: 'text', text: 'a' }, { type: 'redacted_thinking' }, { type: 'text', text: 'b' }] })).toBe('ab');
  });
  it('is empty without content', () => {
    expect(anthropicText({})).toBe('');
  });
});
