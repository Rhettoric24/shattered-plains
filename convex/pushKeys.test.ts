import { describe, expect, test } from "vitest";
import { normalizeVapidKey } from "./pushKeys";

describe("VAPID key normalization", () => {
  test("removes whitespace and Base64 padding accepted by generic encoders", () => {
    expect(normalizeVapidKey("  abc_DEF-123==\r\n")).toBe("abc_DEF-123");
  });

  test("preserves a valid URL-safe key and rejects empty configuration", () => {
    expect(normalizeVapidKey("abc_DEF-123")).toBe("abc_DEF-123");
    expect(normalizeVapidKey(" === ")).toBeUndefined();
    expect(normalizeVapidKey(undefined)).toBeUndefined();
  });
});
