import { describe, it, expect } from 'vitest';
import { extractPythonBlock } from '../agent-loop';

const F = '```';

describe('extractPythonBlock', () => {
  it('keeps code that strips markdown fences from AI output', () => {
    // A lazy match stopped at the fence inside the string and returned a script cut off mid-line.
    const code = `text = ask_ai(prompt)\nif text.startswith("${F}"):\n    text = text.split("\\n", 1)[1].rsplit("${F}", 1)[0]\nprint(text)`;
    expect(extractPythonBlock(`Here you go:\n${F}python\n${code}\n${F}\nDone.`)).toBe(code);
  });

  it('prefers the python block over an earlier example block', () => {
    expect(extractPythonBlock(`${F}json\n{"a": 1}\n${F}\n\n${F}python\nprint(1)\n${F}`)).toBe('print(1)');
  });

  it('accepts an unlabelled fence and a fence without trailing newline', () => {
    expect(extractPythonBlock(`${F}\nx = 1\n${F}`)).toBe('x = 1');
    expect(extractPythonBlock(`${F}python\nx = 2${F}`)).toBe('x = 2');
  });

  it('returns null without a code block', () => {
    expect(extractPythonBlock('No code here.')).toBeNull();
  });
});
