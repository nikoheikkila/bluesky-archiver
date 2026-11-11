/**
 * The largest response body read in full. A page of 100 records is about 100 KB, so the cap leaves
 * ample room while keeping a run far below the Worker's 128 MB memory limit.
 */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * Reads a JSON body of at most `maxBytes`. A body declared or streamed larger is cancelled and
 * rejected, so a misbehaving server cannot exhaust the Worker's memory. Invalid JSON rejects with a
 * `SyntaxError`, as `response.json()` does.
 */
export async function readJson<T>(
  response: Response,
  maxBytes: number = MAX_RESPONSE_BYTES,
): Promise<T> {
  if (Number(response.headers.get("Content-Length")) > maxBytes) {
    await response.body?.cancel();
    throw tooLarge(maxBytes);
  }
  return JSON.parse(await readText(response.body ?? new Blob().stream(), maxBytes)) as T;
}

async function readText(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * Cancels a body that will not be read, so the Workers runtime releases the connection at once. A
 * body already read, or a cancel that fails, is ignored: the caller's own error is what matters.
 */
export async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function tooLarge(maxBytes: number): Error {
  return new Error(`response body exceeds ${maxBytes} bytes`);
}
