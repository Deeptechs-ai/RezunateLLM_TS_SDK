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
    const lineMayHaveEnded = LINE_BREAK.test(text) || buffer.endsWith("\r");
    buffer += text;
    // Split only when a line can have ended, so a very long line is not re-split on every piece.
    if (lineMayHaveEnded) {
      // A trailing "\r" may be the first half of "\r\n", so keep it until more text arrives.
      const end = buffer.endsWith("\r") ? buffer.length - 1 : buffer.length;
      const lines = buffer.slice(0, end).split(LINE_BREAK);
      buffer = (lines.pop() ?? "") + buffer.slice(end);
      yield* lines;
    }
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

/** Split "field: value" into its parts; one leading space is dropped from the value. */
function splitField(line: string): [string, string] {
  const colon = line.indexOf(":");
  if (colon === -1) {
    return [line, ""];
  }
  const value = line.slice(colon + 1);
  return [line.slice(0, colon), value.startsWith(" ") ? value.slice(1) : value];
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
    } else if (!line.startsWith(":")) {
      const [field, value] = splitField(line);
      if (field === "event") {
        event = value;
      } else if (field === "data") {
        dataBuf.push(value);
      }
      // id, retry, and unknown fields ignored
    }
  }

  const out = flush(event, dataBuf);
  if (out) {
    yield out;
  }
}
