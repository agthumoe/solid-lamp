/**
 * Single-consumer async queue: the gate job pushes events while the HTTP response pulls them.
 * Buffering is bounded in practice by the request's num_ctx (one event per token).
 */
export const createEventChannel = <T extends object>() => {
  const buffer: T[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  return {
    push: (value: T): void => {
      if (closed) return;
      buffer.push(value);
      notify();
    },
    close: (): void => {
      closed = true;
      notify();
    },
    async *drain(): AsyncGenerator<T> {
      for (;;) {
        const next = buffer.shift();
        if (next) yield next;
        else if (closed) return;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
};
