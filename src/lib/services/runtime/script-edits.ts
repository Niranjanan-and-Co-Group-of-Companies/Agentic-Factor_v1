/**
 * Fixes to long scripts come back as edits, not as the whole script. A Zoho Books quarter script
 * (26K characters) was rewritten in full to change four vendor-payment calls: ~11K output tokens,
 * ~80s and ~460 credits per fix, and the time left the step no room to run the fix.
 */

/** Scripts at least this long are fixed with edit blocks. */
export const EDIT_MIN_CHARS = 6000;

export const EDIT_FORMAT = `RETURN ONLY YOUR CHANGES, as edit blocks — not the whole script:
<<<<<<< SEARCH
(lines copied exactly from the script, with their indentation — enough lines to be unique)
=======
(the lines that replace them)
>>>>>>> REPLACE
One block per change, in any number. Each SEARCH must match the script exactly once. To add code, SEARCH for the line next to where it goes and repeat that line in the replacement together with the new lines. To delete, leave the replacement empty. Only if the script must be rewritten from scratch, return the complete script in a \`\`\`python block instead.`;

const BLOCK = /<{7} SEARCH[ \t]*\r?\n([\s\S]*?)\r?\n?={7}[ \t]*\r?\n([\s\S]*?)\r?\n?>{7} REPLACE/g;

export function hasEditBlocks(reply: string): boolean {
  return /<{7} SEARCH/.test(reply) && />{7} REPLACE/.test(reply);
}

/** Where `search` occurs in `lines`, comparing lines without trailing whitespace. */
function findLines(lines: string[], search: string[]): number[] {
  const at: number[] = [];
  for (let i = 0; i + search.length <= lines.length; i++) {
    if (search.every((s, j) => lines[i + j].trimEnd() === s.trimEnd())) at.push(i);
  }
  return at;
}

/** Applies a reply's edit blocks to the script, in order; an error names the first block that did not match once. */
export function applyScriptEdits(code: string, reply: string): { code: string } | { error: string } {
  let lines = code.split('\n');
  const blocks = [...reply.matchAll(BLOCK)];
  if (blocks.length === 0) return { error: 'The reply had no complete edit block.' };
  for (const [n, block] of blocks.entries()) {
    const search = block[1].split('\n');
    while (search.length && search[search.length - 1].trim() === '') search.pop();
    while (search.length && search[0].trim() === '') search.shift();
    if (search.length === 0) return { error: `Edit ${n + 1} has an empty SEARCH.` };
    const at = findLines(lines, search);
    if (at.length !== 1) {
      return { error: `Edit ${n + 1}'s SEARCH ${at.length ? `matches ${at.length} places` : 'is not in the script'}: ${search.slice(0, 3).join(' / ').slice(0, 200)}` };
    }
    const replacement = block[2] === '' ? [] : block[2].split('\n');
    lines = [...lines.slice(0, at[0]), ...replacement, ...lines.slice(at[0] + search.length)];
  }
  return { code: lines.join('\n') };
}
