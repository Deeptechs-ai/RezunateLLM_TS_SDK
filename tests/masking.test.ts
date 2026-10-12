/**
 * Tests for reversible masking, ported from the `TestMaskVault` tests in the Python
 * `tests/guardrails/test_reversible_masking.py`. Added in the TS port: character positions
 * with emoji, and splitTrailingPartial.
 */

import { describe, expect, it } from "vitest";
import { MaskVault, splitTrailingPartial, unmask } from "../src/rezunateLlmSdk/masking";

describe("MaskVault", () => {
  it("gives the same value the same placeholder", () => {
    const vault = new MaskVault();
    const first = vault.assign("person name", "John");
    const again = vault.assign("person name", "John");
    const other = vault.assign("person name", "Jane");

    expect(first).toBe("[PERSON_NAME_1]");
    expect(again).toBe(first);
    expect(other).toBe("[PERSON_NAME_2]");
  });

  it("restores placeholders to the original values", () => {
    const vault = new MaskVault();
    const p1 = vault.assign("email address", "john@acme.com");
    const p2 = vault.assign("email address", "jane@acme.com");

    expect(vault.restore(`Draft to ${p1} and cc ${p2}.`)).toBe(
      "Draft to john@acme.com and cc jane@acme.com.",
    );
  });

  it("masks detected spans", () => {
    const text = "My email is john@acme.com now";
    const vault = new MaskVault();

    const masked = vault.maskEntities(text, [{ label: "email address", start: 12, end: 25 }]);

    expect(masked).toBe("My email is [EMAIL_ADDRESS_1] now");
    expect(vault.restore(masked)).toBe(text);
  });

  it("counts positions as characters, like the scan does, even after an emoji", () => {
    const text = "😀 Mail john@acme.com";
    const vault = new MaskVault();

    expect(vault.maskEntities(text, [{ label: "email", start: 7, end: 20 }])).toBe(
      "😀 Mail [EMAIL_1]",
    );
  });

  it("skips invalid spans, and keeps the later one of two overlapping spans", () => {
    const vault = new MaskVault();

    // Spans are replaced right to left, so "Khan" (4-8) wins over "Ali Khan" (0-8).
    const masked = vault.maskEntities("Ali Khan and Sara", [
      { label: "person", start: 0, end: 8 },
      { label: "person", start: 4, end: 8 },
      { label: "person", start: 13, end: 99 },
      { label: "person", start: 5, end: 5 },
    ]);

    expect(masked).toBe("Ali [PERSON_1] and Sara");
  });

  it("keeps and extends the map after dumps and loads", () => {
    const vault = new MaskVault();
    vault.assign("email address", "john@acme.com");

    const reloaded = MaskVault.loads(vault.dumps());

    expect(reloaded.restore("[EMAIL_ADDRESS_1]")).toBe("john@acme.com");
    expect(reloaded.assign("email address", "john@acme.com")).toBe("[EMAIL_ADDRESS_1]");
    expect(reloaded.assign("email address", "kate@acme.com")).toBe("[EMAIL_ADDRESS_2]");
    expect(reloaded.mapping).toEqual({
      "[EMAIL_ADDRESS_1]": "john@acme.com",
      "[EMAIL_ADDRESS_2]": "kate@acme.com",
    });
  });

  it("keeps vaults separate", () => {
    const userA = new MaskVault();
    const userB = new MaskVault();
    userA.assign("email address", "a@acme.com");
    userB.assign("email address", "b@acme.com");

    expect(userA.restore("[EMAIL_ADDRESS_1]")).toBe("a@acme.com");
    expect(userB.restore("[EMAIL_ADDRESS_1]")).toBe("b@acme.com");
    expect(new MaskVault().isEmpty()).toBe(true);
    expect(userA.isEmpty()).toBe(false);
  });

  it("restores through the unmask helper", () => {
    const vault = new MaskVault();
    const placeholder = vault.assign("phone", "555-111-2222");

    expect(unmask(`call ${placeholder}`, vault)).toBe("call 555-111-2222");
  });
});

describe("splitTrailingPartial", () => {
  it("holds back a placeholder that hasn't finished arriving", () => {
    expect(splitTrailingPartial("Hello [EMAIL_AD")).toEqual(["Hello ", "[EMAIL_AD"]);
  });

  it("returns complete text unchanged", () => {
    expect(splitTrailingPartial("Hello [EMAIL_1] bye")).toEqual(["Hello [EMAIL_1] bye", ""]);
    expect(splitTrailingPartial("no brackets")).toEqual(["no brackets", ""]);
  });
});
