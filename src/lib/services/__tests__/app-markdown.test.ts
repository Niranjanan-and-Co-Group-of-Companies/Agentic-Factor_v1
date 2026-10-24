// The reply Markdown parser the app draws replies with (src/lib/contracts/markdown.ts).
import { describe, expect, it } from 'vitest';

import { parseMarkdown, parseInline } from '@/lib/contracts';

describe("the app's Markdown", () => {
  it('reads a table, with its alignment, bold cells and missing cells', () => {
    const blocks = parseMarkdown([
      'Main integrations:',
      '',
      '| Category | Apps | Count |',
      '|---|:---:|---:|',
      '| **Email** | Gmail, Outlook | 2 |',
      '| CRM | HubSpot |',
      '',
      'Done.',
    ].join('\n'));
    expect(blocks.map(b => b.kind)).toEqual(['paragraph', 'table', 'paragraph']);
    const table = blocks[1];
    if (table.kind !== 'table') throw new Error('not a table');
    expect(table.align).toEqual(['left', 'center', 'right']);
    expect(table.header).toHaveLength(3);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][0]).toEqual([{ kind: 'bold', text: 'Email' }]);
    expect(table.rows[1][2]).toEqual([]);
  });

  it('reads the table the assistant sent in one line block (as in the screenshot)', () => {
    const blocks = parseMarkdown('| Category | Apps |\n|---|---|\n| Email | Gmail |\n| Social | Instagram |');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('table');
  });

  it('keeps sub-points, numbers and dividers', () => {
    const blocks = parseMarkdown('1. First\n   - detail\n2. Second\n\n---\n#### Small heading');
    expect(blocks[0]).toMatchObject({ kind: 'list', items: [{ depth: 0, n: 1 }, { depth: 1 }, { depth: 0, n: 2 }] });
    expect(blocks[1].kind).toBe('rule');
    expect(blocks[2]).toMatchObject({ kind: 'heading', level: 4 });
  });

  it('links bare addresses and reads strikethrough and bold italic', () => {
    expect(parseInline('see https://agenticfactor.io/pricing.')).toEqual([
      { kind: 'text', text: 'see ' }, { kind: 'link', text: 'https://agenticfactor.io/pricing', url: 'https://agenticfactor.io/pricing' }, { kind: 'text', text: '.' },
    ]);
    expect(parseInline('~~old~~ ***new***')).toEqual([{ kind: 'strike', text: 'old' }, { kind: 'text', text: ' ' }, { kind: 'boldItalic', text: 'new' }]);
  });

  it('does not take a sentence with a pipe for a table', () => {
    expect(parseMarkdown('Use A | B for this.').map(b => b.kind)).toEqual(['paragraph']);
  });
});
