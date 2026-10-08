import { describe, it, expect } from 'vitest';
import { autoFixComposioParams, checkComposioParams, findComposioCalls } from '../composio-param-check';

const schemas = new Map([
  ['GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN', { input_parameters: { properties: { title: {}, markdown_text: {} }, required: ['title', 'markdown_text'] } }],
  ['GMAIL_SEND_EMAIL', { input_parameters: { properties: { recipient_email: {}, subject: {}, body: {}, is_html: {} }, required: ['recipient_email'] } }],
]);

describe('checkComposioParams', () => {
  it('catches the wrong parameter name that produced an empty Google Doc', () => {
    const code = `create_result = composio_execute('GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN', {\n    'title': title,\n    'markdown': blog_content\n})`;
    const [problem] = checkComposioParams(code, schemas);
    expect(problem).toContain("unknown parameter(s) 'markdown'");
    expect(problem).toContain("missing required 'markdown_text'");
    expect(problem).toContain('Valid parameters: title, markdown_text');
  });

  it('passes a correct call, including nested dicts and triple-quoted values', () => {
    const code = `composio_execute("GMAIL_SEND_EMAIL", {"recipient_email": to, "subject": f"Report {d}", "body": """Hi,\n{'not': 'a key'}\nThanks""", "is_html": False})`;
    expect(checkComposioParams(code, schemas)).toEqual([]);
  });

  it('skips calls it cannot check statically', () => {
    expect(checkComposioParams(`composio_execute('GMAIL_SEND_EMAIL', params)`, schemas)).toEqual([]);
    expect(checkComposioParams(`composio_execute('GMAIL_SEND_EMAIL', {**base, 'subject': s})`, schemas)).toEqual([]);
    expect(checkComposioParams(`composio_execute('UNKNOWN_ACTION_X', {'a': 1})`, schemas)).toEqual([]);
  });

  it('only reads top-level keys', () => {
    const [call] = findComposioCalls(`composio_execute('GMAIL_SEND_EMAIL', {'recipient_email': x, 'body': json.dumps({'inner': 1})})`);
    expect(call.keys).toEqual(['recipient_email', 'body']);
  });
});

describe('autoFixComposioParams', () => {
  it("renames 'markdown' to the only matching valid parameter, then the call checks clean", () => {
    const code = `composio_execute('GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN', {\n    'title': title,\n    'markdown': body  # 'markdown' in a comment\n})`;
    const { code: fixed, renames } = autoFixComposioParams(code, schemas);
    expect(renames).toEqual(["GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN: 'markdown' → 'markdown_text'"]);
    expect(fixed).toContain(`'markdown_text': body  # 'markdown' in a comment`);
    expect(checkComposioParams(fixed, schemas)).toEqual([]);
  });

  it('leaves ambiguous, too-short or already-present names for the fixer', () => {
    const many = new Map([['X_ACTION', { input_parameters: { properties: { query_text: {}, query_type: {} } } }]]);
    expect(autoFixComposioParams(`composio_execute("X_ACTION", {"query": q})`, many).renames).toEqual([]);
    const short = new Map([['GMAIL_SEND_EMAIL', { input_parameters: { properties: { to_email: {} } } }]]);
    expect(autoFixComposioParams(`composio_execute("GMAIL_SEND_EMAIL", {"to": a})`, short).renames).toEqual([]);
    const code = `composio_execute('GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN', {'markdown_text': a, 'markdown': b, 'title': t})`;
    expect(autoFixComposioParams(code, schemas).renames).toEqual([]);
  });

  it('fixes several calls in one script', () => {
    const code = `composio_execute("GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN", {"title": a, "markdown": b})\ncomposio_execute("GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN", {"title": c, "markdown": d})`;
    const { code: fixed, renames } = autoFixComposioParams(code, schemas);
    expect(renames).toHaveLength(2);
    expect(fixed.match(/"markdown_text"/g)).toHaveLength(2);
  });
});
