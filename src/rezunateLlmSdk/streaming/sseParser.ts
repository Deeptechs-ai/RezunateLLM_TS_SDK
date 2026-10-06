/**
 * SSE (Server-Sent Events) line parser.
 * Turns a stream of text lines into events, one per dispatched event.
 */

/** A single dispatched Server-Sent Event frame. */
export interface SSEEvent {
  event: string;
  data: string;
}

/** Any of the three line endings SSE allows. */
const LINE_BREAK = /\r\n|\r|\n/;

/**
 * Decode a byte stream (such as a fetch body) into text lines, without line endings.
 * The TS counterpart of httpx's `iter_lines()`.
 */
export async function* readLines(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const bytes of body) {
    const text = decoder.decode(bytes, { stream: true });
    // Split only when a line can have ended, so a very long line is not re-split on every piece.
    if (!LINE_BREAK.test(text) && !buffer.endsWith("\r")) {
      buffer += text;
      continue;
    }
    buffer += text;
    // A trailing "\r" may be the first half of "\r\n", so keep it until more text arrives.
    const end = buffer.endsWith("\r") ? buffer.length - 1 : buffer.length;
    const lines = buffer.slice(0, end).split(LINE_BREAK);
    buffer = (lines.pop() ?? "") + buffer.slice(end);
    yield* lines;
  }

  buffer += decoder.decode();
  if (buffer !== "") {
    yield* buffer.split(LINE_BREAK);
  }
}

function flush(event: string, dataBuf: string[]): SSEEvent | null {
  if (dataBuf.length === 0) {
    return null;
  }
  return { event: event || "message", data: dataBuf.join("\n") };
}

/**
 * Parse SSE frames from text lines, yielding one event per dispatched frame.
 * Comments (lines starting with ":") and unknown fields are ignored, matching the WHATWG spec.
 */
export async function* parseSseLines(
  lines: AsyncIterable<string> | Iterable<string>,
): AsyncGenerator<SSEEvent> {
  let event = "";
  let dataBuf: string[] = [];

  for await (const raw of lines) {
    const line = raw.replace(/[\r\n]+$/, "");
    if (line === "") {
      const out = flush(event, dataBuf);
      if (out) {
        yield out;
      }
      event = "";
      dataBuf = [];
      continue;
    }
    if (line.startsWith(":")) {
      continue;
    }

    let field = line;
    let value = "";
    const colon = line.indexOf(":");
    if (colon !== -1) {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }
    }
    if (field === "event") {
      event = value;
    } else if (field === "data") {
      dataBuf.push(value);
    }
    // id, retry, and unknown fields ignored
  }

  const out = flush(event, dataBuf);
  if (out) {
    yield out;
  }
}
