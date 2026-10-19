// Reads a server-sent event stream ("data: {...}\n\n") into JSON events, however the bytes arrive.

export function createSSEParser<T = Record<string, unknown>>() {
  let buffer = '';
  return {
    /** Feeds a chunk of text; returns the complete events it finished. */
    push(chunk: string): T[] {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      const events: T[] = [];
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        try { events.push(JSON.parse(raw) as T); } catch { /* a malformed line is skipped */ }
      }
      return events;
    },
  };
}
