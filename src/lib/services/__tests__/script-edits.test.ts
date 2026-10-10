import { describe, it, expect } from 'vitest';
import { applyScriptEdits, hasEditBlocks } from '../runtime/script-edits';

const script = [
  'import json',
  'def pay(bill):',
  '    return composio_proxy("zoho_books", "POST", "/books/v3/vendorpayments", body=bill)',
  '',
  'for b in bills:',
  '    pay(b)',
  'print(json.dumps({"ok": True}))',
].join('\n');

const edit = (search: string, replace: string) => `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;

describe('applyScriptEdits', () => {
  it('replaces the matched lines', () => {
    const reply = `Use the action instead.\n\n${edit(
      '    return composio_proxy("zoho_books", "POST", "/books/v3/vendorpayments", body=bill)',
      '    return composio_execute("ZOHO_BOOKS_CREATE_VENDOR_PAYMENT", bill)',
    )}`;
    const out = applyScriptEdits(script, reply);
    expect('code' in out && out.code).toContain('composio_execute("ZOHO_BOOKS_CREATE_VENDOR_PAYMENT", bill)');
    expect('code' in out && out.code).not.toContain('composio_proxy');
  });

  it('applies several edits in order and ignores trailing whitespace', () => {
    const reply = [edit('import json   ', 'import json\nimport sys'), edit('    pay(b)', '    pay(b)\n    sys.stderr.write("paid\\n")')].join('\n');
    const out = applyScriptEdits(script, reply);
    expect('code' in out && out.code.split('\n').slice(0, 2)).toEqual(['import json', 'import sys']);
    expect('code' in out && out.code).toContain('sys.stderr.write');
  });

  it('deletes lines when the replacement is empty', () => {
    const out = applyScriptEdits(script, `<<<<<<< SEARCH\n    pay(b)\n=======\n>>>>>>> REPLACE`);
    expect('code' in out && out.code).not.toContain('    pay(b)');
  });

  it('works inside a code fence', () => {
    const out = applyScriptEdits(script, '```python\n' + edit('    pay(b)', '    pay(dict(b))') + '\n```');
    expect('code' in out && out.code).toContain('pay(dict(b))');
  });

  it('reports a SEARCH that is missing or ambiguous', () => {
    expect(applyScriptEdits(script, edit('    pay(x)', 'y'))).toMatchObject({ error: expect.stringContaining('not in the script') });
    expect(applyScriptEdits('a\nb\na', edit('a', 'c'))).toMatchObject({ error: expect.stringContaining('matches 2 places') });
  });

  it('recognises edit replies', () => {
    expect(hasEditBlocks(edit('a', 'b'))).toBe(true);
    expect(hasEditBlocks('```python\nprint(1)\n```')).toBe(false);
  });
});
