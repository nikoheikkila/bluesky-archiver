/** A body that never ends and stays open until cancelled; `cancelled` records each cancel. */
export function endlessBody(cancelled: unknown[], chunk = "{}"): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode(chunk));
    },
    cancel(reason) {
      cancelled.push(reason);
    },
  });
}
