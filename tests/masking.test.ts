/**
 * Tests for reversible masking, ported from the `TestMaskVault` tests in the Python
 * `tests/guardrails/test_reversible_masking.py`, with placeholders built as in
 * `rezunate_guard/masking.py`. Added in the TS port: character positions with emoji,
 * placeholder clashes, single-pass restore, and splitTrailingPartial.
 */

import { describe, expect, it } from "vitest";
import {
  MaskingError,
  MaskVault,
  placeholder,
  splitTrailingPartial,
  unmask,
} from "../src/rezunateLlmSdk/masking";
import { TEST_MASK_KEY } from "./fixtures";

/** The placeholder a value gets with the test key. */
const code = (label: string, value: string) => placeholder(label, value, TEST_MASK_KEY);

describe("MaskVault", () => {
  it("gives the same value the same placeholder", () => {
    const vault = new MaskVault(TEST_MASK_KEY);
    const first = vault.assign("person name", "John");
    const again = vault.assign("person name", "John");
    const other = vault.assign("person name", "Jane");

    expect(first).toMatch(/^\[PERSON_NAME_[0-9a-f]{4}\]$/);
    expect(first).toBe(code("person name", "John"));
    expect(again).toBe(first);
    expect(other).toBe(code("person name", "Jane"));
    expect(other).not.toBe(first);
  });

  it("restores placeholders to the original values", () => {
    const vault = new MaskVault(TEST_MASK_KEY);
    const p1 = vault.assign("email address", "john@acme.com");
    const p2 = vault.assign("email address", "jane@acme.com");

    expect(vault.restore(`Draft to ${p1} and cc ${p2}.`)).toBe(
      "Draft to john@acme.com and cc jane@acme.com.",
    );
  });

  it("masks detected spans", () => {
    const text = "My email is john@acme.com now";
    const vault = new MaskVault(TEST_MASK_KEY);

    const masked = vault.maskEntities(text, [{ label: "email address", start: 12, end: 25 }]);

    expect(masked).toBe(`My email is ${code("email address", "john@acme.com")} now`);
    expect(vault.restore(masked)).toBe(text);
  });

  it("counts positions as characters, like the scan does, even after an emoji", () => {
    const text = "😀 Mail john@acme.com";
    const vault = new MaskVault(TEST_MASK_KEY);

    expect(vault.maskEntities(text, [{ label: "email", start: 7, end: 20 }])).toBe(
      `😀 Mail ${code("email", "john@acme.com")}`,
    );
  });

  it("skips spans outside the text", () => {
    const vault = new MaskVault(TEST_MASK_KEY);

    const masked = vault.maskEntities("Ali and Sara", [
      { label: "person", start: 8, end: 12 },
      { label: "person", start: 8, end: 99 },
      { label: "person", start: 5, end: 5 },
    ]);

    expect(masked).toBe(`Ali and ${code("person", "Sara")}`);
  });

  it("throws MaskingError on overlapping spans instead of sending them unmasked", () => {
    const vault = new MaskVault(TEST_MASK_KEY);

    expect(() =>
      vault.maskEntities("Ali Khan", [
        { label: "person", start: 0, end: 8 },
        { label: "surname", start: 4, end: 8 },
      ]),
    ).toThrow(MaskingError);
  });

  it("gives a value a longer placeholder when its short one is taken", () => {
    // Find two values whose placeholders share the same first digits.
    const seen = new Map<string, string>();
    let clash: [string, string] | null = null;
    for (let i = 0; clash === null; i++) {
      const value = `user${i}`;
      const other = seen.get(code("person", value));
      if (other) {
        clash = [other, value];
      } else {
        seen.set(code("person", value), value);
      }
    }
    const [first, second] = clash;
    const vault = new MaskVault(TEST_MASK_KEY);

    const p1 = vault.assign("person", first);
    const p2 = vault.assign("person", second);

    expect(p1).toBe(code("person", first));
    expect(p2).toBe(placeholder("person", second, TEST_MASK_KEY, 6));
    expect(vault.restore(`${p1} and ${p2}`)).toBe(`${first} and ${second}`);
  });

  it("restores in one pass, so a restored value is never restored again", () => {
    const vault = new MaskVault(TEST_MASK_KEY);
    const id = vault.assign("id", "Ali");
    const note = vault.assign("person", `see ${id}`);

    expect(vault.restore(note)).toBe(`see ${id}`);
  });

  it("keeps the key and the map after dumps and loads", () => {
    const vault = new MaskVault(TEST_MASK_KEY);
    const john = vault.assign("email address", "john@acme.com");

    const reloaded = MaskVault.loads(vault.dumps());

    expect(reloaded.restore(john)).toBe("john@acme.com");
    expect(reloaded.assign("email address", "john@acme.com")).toBe(john);
    const kate = reloaded.assign("email address", "kate@acme.com");
    expect(kate).toBe(code("email address", "kate@acme.com"));
    expect(reloaded.mapping).toEqual({ [john]: "john@acme.com", [kate]: "kate@acme.com" });
  });

  it("rejects data that isn't dumps() output", () => {
    expect(() => MaskVault.loads('{"key":"not-hex"}')).toThrow();
    expect(() => MaskVault.loads('{"map":{"[A_1f2e]":42}}')).toThrow();
  });

  it("keeps vaults separate", () => {
    const userA = new MaskVault();
    const userB = new MaskVault();
    const a = userA.assign("email address", "a@acme.com");
    const b = userB.assign("email address", "a@acme.com");

    // Each vault has its own random key, so the same value gets a different placeholder.
    expect(a).not.toBe(b);
    expect(userA.restore(a)).toBe("a@acme.com");
    expect(userB.restore(a)).toBe(a);
    expect(new MaskVault().isEmpty()).toBe(true);
    expect(userA.isEmpty()).toBe(false);
  });

  it("restores through the unmask helper", () => {
    const vault = new MaskVault(TEST_MASK_KEY);
    const token = vault.assign("phone", "555-111-2222");

    expect(unmask(`call ${token}`, vault)).toBe("call 555-111-2222");
  });
});

describe("splitTrailingPartial", () => {
  it("holds back a placeholder that hasn't finished arriving", () => {
    expect(splitTrailingPartial("Hello [EMAIL_AD")).toEqual(["Hello ", "[EMAIL_AD"]);
  });

  it("returns complete text unchanged", () => {
    expect(splitTrailingPartial("Hello [EMAIL_7f3a] bye")).toEqual(["Hello [EMAIL_7f3a] bye", ""]);
    expect(splitTrailingPartial("no brackets")).toEqual(["no brackets", ""]);
  });
});
