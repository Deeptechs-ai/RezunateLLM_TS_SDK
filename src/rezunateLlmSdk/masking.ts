/** Reversible masking: PII is replaced with placeholders, then restored in the reply. */

/** A detected span to mask: `start`/`end` are character positions, as the scan reports them. */
export interface MaskSpan {
  start: number;
  end: number;
  label: string;
}

/** Make a placeholder tag from a label: "email address" -> "EMAIL_ADDRESS". */
function normalizeLabel(label: string): string {
  const tag = label
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return tag || "PII";
}

/**
 * A two-way map between PII values and placeholder tokens.
 * The same value always gets the same placeholder (so the model sees
 * "[PERSON_1] emailed [PERSON_1]"), and each distinct value gets its own.
 */
export class MaskVault {
  private readonly toPlaceholder = new Map<string, string>();
  private readonly toOriginal = new Map<string, string>();
  private readonly counters = new Map<string, number>();

  /** Return the placeholder for `original`, creating a new one if it hasn't been seen. */
  assign(label: string, original: string): string {
    const existing = this.toPlaceholder.get(original);
    if (existing !== undefined) {
      return existing;
    }

    const tag = normalizeLabel(label);
    const count = (this.counters.get(tag) ?? 0) + 1;
    this.counters.set(tag, count);
    const placeholder = `[${tag}_${count}]`;
    this.toPlaceholder.set(original, placeholder);
    this.toOriginal.set(placeholder, original);
    return placeholder;
  }

  /**
   * Replace detected spans in `text` with placeholders.
   * Spans are replaced right to left so positions stay valid; overlapping spans are skipped.
   */
  maskEntities(text: string, entities: Iterable<MaskSpan>): string {
    // Positions count characters as Python does (an emoji is one character, not two).
    const chars = Array.from(text);
    const spans = Array.from(entities, ({ start, end, label }) => ({
      start: Number(start),
      end: Number(end),
      label: String(label),
    })).sort((a, b) => b.start - a.start);

    let prevStart: number | null = null;
    for (const { start, end, label } of spans) {
      if (start < 0 || end > chars.length || start >= end) {
        continue;
      }
      // Right to left, so a span that ends past the previous span's start overlaps it.
      if (prevStart !== null && end > prevStart) {
        continue;
      }
      const placeholder = this.assign(label, chars.slice(start, end).join(""));
      chars.splice(start, end - start, placeholder);
      prevStart = start;
    }
    return chars.join("");
  }

  /** Swap every known placeholder in `text` back to its original value. */
  restore(text: string): string {
    if (this.toOriginal.size === 0 || !text) {
      return text;
    }
    // Longest placeholder first, so no token is a prefix of another.
    const pairs = [...this.toOriginal].sort(([a], [b]) => b.length - a.length);
    let restored = text;
    for (const [placeholder, original] of pairs) {
      if (restored.includes(placeholder)) {
        restored = restored.replaceAll(placeholder, original);
      }
    }
    return restored;
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
      map: Object.fromEntries(this.toOriginal),
      counters: Object.fromEntries(this.counters),
    });
  }

  /** Rebuild a vault from `dumps()` output. */
  static loads(data: string): MaskVault {
    const parsed = JSON.parse(data) as {
      map?: Record<string, string>;
      counters?: Record<string, number>;
    };
    const vault = new MaskVault();
    for (const [placeholder, original] of Object.entries(parsed.map ?? {})) {
      vault.toOriginal.set(placeholder, original);
      vault.toPlaceholder.set(original, placeholder);
    }
    for (const [tag, count] of Object.entries(parsed.counters ?? {})) {
      vault.counters.set(tag, Number(count));
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
 * When the text ends with a "[" that has no closing "]", the rest of a placeholder is probably
 * still on its way. Returns `[safe, held]`: restore `safe` now, and put `held` in front of the
 * next piece of text.
 */
export function splitTrailingPartial(text: string): [string, string] {
  const index = text.lastIndexOf("[");
  if (index !== -1 && !text.slice(index).includes("]")) {
    return [text.slice(0, index), text.slice(index)];
  }
  return [text, ""];
}
