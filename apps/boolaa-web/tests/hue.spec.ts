import { expect, test } from "@playwright/test";
import { fnv1a, hueFor } from "../src/lib/hue";

// Test vectors from docs/design-system.md section 2.3, shared with iOS and Android.
test("FNV-1a and bubble hue match the shared test vectors", () => {
  expect(fnv1a("")).toBe(2166136261);
  expect(fnv1a("a")).toBe(3826002220);
  expect(fnv1a("boolaa")).toBe(3352750575);
  expect(hueFor("aaaaaaaa-0000-0000-0000-000000000001")).toBe("sky");
  expect(hueFor("aaaaaaaa-0000-0000-0000-000000000002")).toBe("tangerine");
  expect(hueFor("AAAAAAAA-0000-0000-0000-000000000002")).toBe("tangerine");
  expect(hueFor("11111111-1111-1111-1111-111111111111")).toBe("sunny");
  expect(hueFor("22222222-2222-2222-2222-222222222222")).toBe("pink");
  expect(hueFor("33333333-3333-3333-3333-333333333333")).toBe("indigo");
});
