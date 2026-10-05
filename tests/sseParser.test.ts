/**
 * Tests for the SSE parser and the byte-to-line reader.
 */

import { describe, expect, it } from "vitest";
import { parseSseLines, readLines } from "../src/rezunateLlmSdk/streaming/sseParser";

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) {
    result.push(item);
  }
  return result;
}

/** A byte stream that delivers the given pieces one by one, like a fetch body. */
async function* bytes(...pieces: (string | Uint8Array)[]): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  for (const piece of pieces) {
    yield typeof piece === "string" ? encoder.encode(piece) : piece;
  }
}

describe("parseSseLines", () => {
  it("yields one event per blank-line-terminated frame", async () => {
    const events = await collect(parseSseLines(["data: one", "", "data: two", ""]));

    expect(events).toEqual([
      { event: "message", data: "one" },
      { event: "message", data: "two" },
    ]);
  });

  it("uses the event field as the event name", async () => {
    const events = await collect(
      parseSseLines(["event: content_block_delta", 'data: {"a":1}', ""]),
    );

    expect(events).toEqual([{ event: "content_block_delta", data: '{"a":1}' }]);
  });

  it("resets the event name after each frame", async () => {
    const events = await collect(parseSseLines(["event: ping", "data: x", "", "data: y", ""]));

    expect(events.map((e) => e.event)).toEqual(["ping", "message"]);
  });

  it("joins several data lines with a newline", async () => {
    const events = await collect(parseSseLines(["data: first", "data: second", ""]));

    expect(events).toEqual([{ event: "message", data: "first\nsecond" }]);
  });

  it("ignores comments", async () => {
    const events = await collect(parseSseLines([": keep-alive", "data: x", ""]));

    expect(events).toEqual([{ event: "message", data: "x" }]);
  });

  it("strips only one leading space from the value", async () => {
    const events = await collect(parseSseLines(["data:no-space", "", "data:  two-spaces", ""]));

    expect(events.map((e) => e.data)).toEqual(["no-space", " two-spaces"]);
  });

  it("keeps colons inside the value", async () => {
    const events = await collect(parseSseLines(['data: {"time":"12:30"}', ""]));

    expect(events[0]?.data).toBe('{"time":"12:30"}');
  });

  it("treats a line without a colon as a field with an empty value", async () => {
    const events = await collect(parseSseLines(["data", ""]));

    expect(events).toEqual([{ event: "message", data: "" }]);
  });

  it("ignores id, retry and unknown fields", async () => {
    const events = await collect(
      parseSseLines(["id: 7", "retry: 1000", "foo: bar", "data: x", ""]),
    );

    expect(events).toEqual([{ event: "message", data: "x" }]);
  });

  it("drops a frame that has no data", async () => {
    const events = await collect(parseSseLines(["event: ping", "", ""]));

    expect(events).toEqual([]);
  });

  it("flushes the last frame when the stream ends without a blank line", async () => {
    const events = await collect(parseSseLines(["data: last"]));

    expect(events).toEqual([{ event: "message", data: "last" }]);
  });

  it("strips line endings left on the lines", async () => {
    const events = await collect(parseSseLines(["data: x\r\n", "\r\n"]));

    expect(events).toEqual([{ event: "message", data: "x" }]);
  });

  it("accepts an async iterable of lines", async () => {
    const events = await collect(parseSseLines(readLines(bytes("data: x\n\n"))));

    expect(events).toEqual([{ event: "message", data: "x" }]);
  });
});

describe("readLines", () => {
  it("splits on \\n, \\r\\n and \\r", async () => {
    const lines = await collect(readLines(bytes("a\nb\r\nc\rd")));

    expect(lines).toEqual(["a", "b", "c", "d"]);
  });

  it("joins a line split across two pieces", async () => {
    const lines = await collect(readLines(bytes("data: hel", "lo\n")));

    expect(lines).toEqual(["data: hello"]);
  });

  it("does not create an extra blank line when \\r\\n is split across pieces", async () => {
    const lines = await collect(readLines(bytes("data: x\r", "\n\r\n")));

    expect(lines).toEqual(["data: x", ""]);
  });

  it("decodes a character split across pieces", async () => {
    const smile = new TextEncoder().encode("😀\n");

    const lines = await collect(readLines(bytes(smile.slice(0, 2), smile.slice(2))));

    expect(lines).toEqual(["😀"]);
  });

  it("yields the last line when it has no line ending", async () => {
    const lines = await collect(readLines(bytes("a\n", "b")));

    expect(lines).toEqual(["a", "b"]);
  });

  it("yields nothing for an empty body", async () => {
    expect(await collect(readLines(bytes()))).toEqual([]);
  });
});
