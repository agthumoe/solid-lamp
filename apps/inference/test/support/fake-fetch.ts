import type { FetchLike } from '../../src/ollama/ollama-http.ts';

export type Recorded = { readonly url: string; readonly method: string; readonly body: unknown };

export type Reply =
  | { readonly kind: 'json'; readonly status?: number; readonly body: unknown }
  | { readonly kind: 'ndjson'; readonly lines: readonly unknown[] } // strings are sent raw
  // Emits the given lines, then errors the body stream (connection dropped mid-stream).
  | { readonly kind: 'drop'; readonly lines: readonly unknown[] }
  | { readonly kind: 'network' }
  // Never answers; rejects when the request signal aborts, like real fetch.
  | { readonly kind: 'hang' };

const encoder = new TextEncoder();
const line = (value: unknown) =>
  encoder.encode(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);

/** A scripted Ollama: each call consumes the next reply and records the request. */
export const fakeFetch = (replies: Reply[]) => {
  const calls: Recorded[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected request ${url}`);
    const signal = init.signal;
    switch (reply.kind) {
      case 'network':
        return Promise.reject(new TypeError('fetch failed'));
      case 'hang':
        return new Promise((_, reject) =>
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        );
      case 'json':
        return Promise.resolve(
          new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 }),
        );
      case 'ndjson':
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (const value of reply.lines) controller.enqueue(line(value));
                controller.close();
              },
            }),
          ),
        );
      case 'drop':
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (const value of reply.lines) controller.enqueue(line(value));
              },
              // Erroring in start() would discard the queued lines; fail on the next read.
              pull(controller) {
                controller.error(new TypeError('terminated'));
              },
            }),
          ),
        );
    }
  };
  return { fetch, calls, pending: () => replies.length };
};

export const noSleep = () => Promise.resolve();
