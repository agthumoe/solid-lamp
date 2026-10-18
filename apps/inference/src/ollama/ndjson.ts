// A single Ollama chunk is small; a line this long means a broken or hostile peer.
const MAX_LINE_CHARS = 1_048_576;

export class NdjsonError extends Error {}

/**
 * Splits a byte stream into parsed JSON lines. Throws `NdjsonError` for malformed JSON or an
 * oversized line; the caller maps that to `INVALID_RESPONSE`.
 */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = '';
  // Every line is bounded before parsing, whether or not its newline arrived in the same chunk.
  const parse = (raw: string): unknown => {
    if (raw.length > MAX_LINE_CHARS) throw new NdjsonError('line exceeds size limit');
    try {
      return JSON.parse(raw.trim());
    } catch {
      throw new NdjsonError('malformed JSON line');
    }
  };
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim()) yield parse(line);
      newline = buffer.indexOf('\n');
    }
    if (buffer.length > MAX_LINE_CHARS) throw new NdjsonError('line exceeds size limit');
  }
  const rest = buffer + decoder.decode();
  if (rest.trim()) yield parse(rest);
}
