/**
 * Reversible masking: PII is replaced with placeholders, then restored in the reply.
 * Placeholders are built as in the Python `rezunate_guard/masking.py`: a hash of the value.
 */

import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import * as constants from "./constants";

/** A detected span to mask: `start`/`end` are character positions, as the scan reports them. */
export interface MaskSpan {
  start: number;
  end: number;
  label: string;
}

/** Spans could not be masked safely. Callers must withhold the content. */
export class MaskingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaskingError";
  }
}

/** A full placeholder: an upper-case tag, then lower-case hex digits. */
const PLACEHOLDER_PATTERN = /\[[A-Z0-9_]+_[0-9a-f]+\]/g;
/** The start of a placeholder that hasn't finished arriving, e.g. "[EMAIL_AD". */
const PARTIAL_PLACEHOLDER_PATTERN = /^\[[A-Z0-9_]*[0-9a-f]*$/;

/** What `MaskVault.dumps()` writes: the key in hex and the placeholder -> original map. */
const VaultDataSchema = z.object({
  key: z
    .string()
    .regex(/^[0-9a-f]+$/)
    .optional(),
  map: z.record(z.string(), z.string()).default({}),
});

/** Make a placeholder tag from a label: "email address" -> "EMAIL_ADDRESS". */
function tag(label: string): string {
  const result = label
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return result || "PII";
}

/** The placeholder for one value, e.g. "[PERSON_7f3a]": its tag and the start of its hash. */
export function placeholder(
  label: string,
  value: string,
  key: Uint8Array,
  digits: number = constants.MASK_SUFFIX_DIGITS,
): string {
  const digest = createHmac("sha256", key).update(value, "utf8").digest("hex");
  return `[${tag(label)}_${digest.slice(0, digits)}]`;
}

/**
 * A two-way map between PII values and placeholder tokens.
 * The same value always gets the same placeholder, and each distinct value gets its own.
 */
export class MaskVault {
  private readonly key: Uint8Array;
  private readonly toPlaceholder = new Map<string, string>();
  private readonly toOriginal = new Map<string, string>();

  /** `key` makes the placeholders; a random one is made when it is left out. */
  constructor(key: Uint8Array = randomBytes(constants.MASK_KEY_BYTES)) {
    this.key = key;
  }

  /** Return the placeholder for `original`, creating a new one if it hasn't been seen. */
  assign(label: string, original: string): string {
    const existing = this.toPlaceholder.get(original);
    if (existing !== undefined) {
      return existing;
    }

    // Two values can share the first digits of their hash; the later one gets more digits.
    let digits = constants.MASK_SUFFIX_DIGITS;
    let token = placeholder(label, original, this.key, digits);
    while (this.toOriginal.has(token)) {
      digits += 2;
      token = placeholder(label, original, this.key, digits);
    }
    this.toPlaceholder.set(original, token);
    this.toOriginal.set(token, original);
    return token;
  }

  /**
   * Replace detected spans in `text` with placeholders, right to left so positions stay valid.
   * Throws `MaskingError` if a span is outside the text or two spans overlap, so PII that
   * can't be masked is never sent. (The Python SDK skips a span outside the text.)
   */
  maskEntities(text: string, entities: Iterable<MaskSpan>): string {
    // Positions count characters as Python does (an emoji is one character, not two).
    const chars = Array.from(text);
    const spans = Array.from(entities, ({ start, end, label }) => ({
      start: Number(start),
      end: Number(end),
      label: String(label),
    })).sort((a, b) => b.start - a.start);

    // Spans are checked against the original length, not the text being changed.
    const length = chars.length;
    let previousStart = length;
    for (const { start, end, label } of spans) {
      if (start < 0 || end > length || start >= end) {
        throw new MaskingError(`Span ${start}:${end} is outside the text and could not be masked.`);
      }
      if (end > previousStart) {
        throw new MaskingError(`Overlapping spans at ${start}:${end} could not be masked.`);
      }
      const token = this.assign(label, chars.slice(start, end).join(""));
      chars.splice(start, end - start, token);
      previousStart = start;
    }
    return chars.join("");
  }

  /** Swap every known placeholder in `text` back to its original value, in one pass. */
  restore(text: string): string {
    if (this.toOriginal.size === 0 || !text) {
      return text;
    }
    return text.replace(PLACEHOLDER_PATTERN, (found) => this.toOriginal.get(found) ?? found);
  }

  /** True if nothing has been masked yet. */
  isEmpty(): boolean {
    return this.toOriginal.size === 0;
  }

  /** A copy of the placeholder -> original map (it contains PII). */
  get mapping(): Record<string, string> {
    return Object.fromEntries(this.toOriginal);
  }

  /** Serialize to JSON, to resume a conversation later. It holds real PII: encrypt it. */
  dumps(): string {
    return JSON.stringify({
      key: Buffer.from(this.key).toString("hex"),
      map: Object.fromEntries(this.toOriginal),
    });
  }

  /**
   * Rebuild a vault from `dumps()` output, with the same key, so values keep their placeholders.
   * Data without a key (older output) gets a new random key: its placeholders still restore,
   * but new values get placeholders from the new key. Throws if `data` isn't valid output.
   */
  static loads(data: string): MaskVault {
    const parsed = VaultDataSchema.parse(JSON.parse(data));
    const vault = parsed.key ? new MaskVault(Buffer.from(parsed.key, "hex")) : new MaskVault();
    for (const [token, original] of Object.entries(parsed.map)) {
      vault.toOriginal.set(token, original);
      vault.toPlaceholder.set(original, token);
    }
    return vault;
  }
}

/** Shorthand for `vault.restore(text)`. */
export function unmask(text: string, vault: MaskVault): string {
  return vault.restore(text);
}

/**
 * Hold back a half-received placeholder while streaming.
 * When the text ends with something that can still become a placeholder (such as "[EMAIL_AD"),
 * the rest is probably on its way. Returns `[safe, held]`: restore `safe` now, and put `held`
 * in front of the next piece of text. Any other "[" (such as "[draft") is sent at once,
 * unlike the Python SDK, which holds every unclosed "[" until the reply ends.
 */
export function splitTrailingPartial(text: string): [string, string] {
  const index = text.lastIndexOf("[");
  const tail = text.slice(index);
  if (
    index !== -1 &&
    tail.length <= constants.MASK_MAX_PARTIAL_CHARS &&
    PARTIAL_PLACEHOLDER_PATTERN.test(tail)
  ) {
    return [text.slice(0, index), tail];
  }
  return [text, ""];
}
