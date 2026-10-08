import { describe, it, expect } from 'vitest';
import { sanitizePythonCode } from '../agent-loop';

const unchanged = (code: string) => expect(sanitizePythonCode(code)).toBe(code);

describe('sanitizePythonCode', () => {
  it('leaves triple-double-quoted multi-line strings alone', () => {
    unchanged('body = """Hello,\nThanks for your order.\n"""\nprint(body)');
  });

  it('leaves f-string triple quotes with text on the opening line alone', () => {
    unchanged('msg = f"""Hi {name},\nYour report is ready.\nRegards"""\nsend(msg)');
  });

  it("leaves triple-single-quoted strings alone", () => {
    unchanged("html = '''<tr>\n<td>x</td>\n</tr>'''");
  });

  it('leaves quote characters inside the other kind of string alone', () => {
    unchanged(`text = (raw\n    .replace('&quot;', '"')\n    .replace('&apos;', "'")\n    .replace("&#39;", "'"))`);
  });

  it('code after a closed triple-quoted block is still checked normally', () => {
    unchanged('doc = """a\nb"""\nx = "ok"\ny = \'fine\'');
  });

  it('still repairs a genuine single-quoted string broken across lines', () => {
    expect(sanitizePythonCode('print("hello\nworld")')).toBe('print("""hello\nworld""")');
  });

  it('leaves a double quote inside single quotes followed by a double-quoted string alone', () => {
    // Real line the old quote counter corrupted into .strip("'""") on every retry.
    unchanged(`subject = results[0].strip().strip('"').strip("'")\nfull_html = "\\n".join(parts)\nprint("done")`);
  });

  it('leaves escaped quotes and comments with quotes alone', () => {
    unchanged(`msg = "She said \\"hi\\""  # it's fine\nx = 'don\\'t'`);
  });

  it('strips null bytes', () => {
    expect(sanitizePythonCode('x = 1\x00\ny = 2')).toBe('x = 1\ny = 2');
  });
});
