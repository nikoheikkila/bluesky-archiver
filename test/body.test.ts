// Workers best practice: a body read in full is capped before it is read.
import { expect, test } from "vitest";
import { discardBody, MAX_RESPONSE_BYTES, readJson } from "../src/body";

const CAP = 10;
const TOO_LARGE = `response body exceeds ${CAP} bytes`;
const encode = (text: string) => new TextEncoder().encode(text);

/** A body served one chunk per pull; `cancelled` records each cancel the source receives. */
function chunkedBody(chunks: Uint8Array[], cancelled: unknown[] = []): ReadableStream<Uint8Array> {
  const queue = [...chunks];
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      return next ? controller.enqueue(next) : controller.close();
    },
    cancel(reason) {
      cancelled.push(reason);
    },
  });
}

/** A body that never ends, as a misbehaving server might send. */
function endlessBody(cancelled: unknown[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(encode("12345"));
    },
    cancel(reason) {
      cancelled.push(reason);
    },
  });
}

const withLength = (body: BodyInit | null, length: number) =>
  new Response(body, { headers: { "Content-Length": String(length) } });

test("caps a body at 8 MiB by default", () => {
  expect(MAX_RESPONSE_BYTES).toBe(8 * 1024 * 1024);
});

test("parses a JSON body within the cap", async () => {
  await expect(readJson(Response.json({ a: 1 }), CAP)).resolves.toStrictEqual({ a: 1 });
});

test("reads the default cap when none is given", async () => {
  await expect(readJson(Response.json({ cursor: "x".repeat(CAP) }))).resolves.toStrictEqual({
    cursor: "x".repeat(CAP),
  });
});

test.each([
  ["at the cap exactly", ['"12345678"']],
  ["split over chunks up to the cap", ['"1234', '5678"']],
])("parses a streamed body %s", async (_case, chunks) => {
  const body = chunkedBody(chunks.map(encode));

  await expect(readJson(new Response(body), CAP)).resolves.toBe("12345678");
});

test("joins a multi-byte character split across chunks", async () => {
  const bytes = encode('"ä"');
  const body = chunkedBody([bytes.slice(0, 2), bytes.slice(2)]);

  await expect(readJson(new Response(body), CAP)).resolves.toBe("ä");
});

test("rejects a streamed body one byte past the cap", async () => {
  const body = chunkedBody([encode('"12345'), encode('6789"')]);

  await expect(readJson(new Response(body), CAP)).rejects.toStrictEqual(new Error(TOO_LARGE));
});

test("stops reading and cancels a body that never ends", async () => {
  const cancelled: unknown[] = [];

  await expect(readJson(new Response(endlessBody(cancelled)), CAP)).rejects.toStrictEqual(
    new Error(TOO_LARGE),
  );
  expect(cancelled).toHaveLength(1);
});

test("rejects a body declared larger than the cap without reading it", async () => {
  const cancelled: unknown[] = [];
  const body = chunkedBody([encode("{}")], cancelled);

  await expect(readJson(withLength(body, CAP + 1), CAP)).rejects.toStrictEqual(
    new Error(TOO_LARGE),
  );
  expect(cancelled).toHaveLength(1);
});

test("rejects an empty body declared larger than the cap", async () => {
  await expect(readJson(withLength(null, CAP + 1), CAP)).rejects.toStrictEqual(
    new Error(TOO_LARGE),
  );
});

test("reads a body declared exactly at the cap", async () => {
  await expect(readJson(withLength('"12345678"', CAP), CAP)).resolves.toBe("12345678");
});

test.each([
  ["invalid JSON", new Response("not json")],
  ["no body", new Response(null)],
])("rejects %s with a SyntaxError, as response.json() does", async (_case, response) => {
  await expect(readJson(response, CAP)).rejects.toThrow(SyntaxError);
});

test("discardBody cancels an unread body", async () => {
  const cancelled: unknown[] = [];

  await discardBody(new Response(endlessBody(cancelled)));

  expect(cancelled).toHaveLength(1);
});

const readByReadJson = async () => {
  const response = Response.json({});
  await readJson(response);
  return response;
};

test.each([
  ["no body", async () => new Response(null)],
  ["a body readJson already read", readByReadJson],
  [
    "a cancel that fails",
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            return Promise.reject(new Error("cancel failed"));
          },
        }),
      ),
  ],
])("discardBody resolves for %s", async (_case, respond) => {
  await expect(discardBody(await respond())).resolves.toBeUndefined();
});
