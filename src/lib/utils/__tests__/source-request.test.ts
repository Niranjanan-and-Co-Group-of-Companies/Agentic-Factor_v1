import { describe, it, expect } from 'vitest';
import { customerWords, withCustomerWords, CUSTOMER_WORDS_HEADING } from '../source-request';

describe('customerWords', () => {
  it('keeps the last three user messages verbatim, oldest first', () => {
    const words = customerWords([
      { role: 'user', content: 'old unrelated request' },
      { role: 'user', content: 'Priya: "We run 40 warehouses."' },
      { role: 'assistant', content: 'One question…' },
      { role: 'user', content: 'Just Slack is fine' },
      { role: 'user', content: 'go' },
    ]);
    expect(words).toBe('Priya: "We run 40 warehouses."\n\n---\n\nJust Slack is fine\n\n---\n\ngo');
  });

  it('keeps the newest message whole when the cap is reached', () => {
    const words = customerWords([
      { role: 'user', content: 'a'.repeat(50) },
      { role: 'user', content: 'b'.repeat(30) },
    ], 40);
    expect(words).toBe(`${'a'.repeat(10)}\n\n---\n\n${'b'.repeat(30)}`);
  });

  it('ignores non-text content', () => {
    expect(customerWords([{ role: 'user', content: [{ type: 'image' }] }])).toBe('');
  });
});

describe('withCustomerWords', () => {
  it('appends the verbatim words under the heading, or leaves the intent alone', () => {
    expect(withCustomerWords('Build a proposal', 'transcript')).toBe(`Build a proposal\n\n${CUSTOMER_WORDS_HEADING}\ntranscript`);
    expect(withCustomerWords('Build a proposal', '  ')).toBe('Build a proposal');
    expect(withCustomerWords('Build a proposal', undefined)).toBe('Build a proposal');
  });
});
