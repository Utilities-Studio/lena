import { expect, test } from "bun:test";
import { array, assert, constantFrom, integer, property } from "fast-check";

import { createStoreKitEntitlementCatalog, parseStoreKitSequence } from "../../src";

const PRODUCTS = Object.freeze({
  annual: { productId: "com.jetseen.annual", productType: "auto-renewable-subscription" },
  lifetime: { productId: "com.jetseen.lifetime", productType: "non-consumable" },
  monthly: { productId: "com.jetseen.monthly", productType: "auto-renewable-subscription" },
} as const);

test("catalog identity is invariant under every generated product permutation", () => {
  const expected = createStoreKitEntitlementCatalog(Object.values(PRODUCTS));
  expect(expected.isOk()).toBe(true);
  if (expected.isErr()) return;

  assert(
    property(
      array(constantFrom(...Object.keys(PRODUCTS)), { minLength: 3, maxLength: 3 }).filter(
        (keys) => new Set(keys).size === 3,
      ),
      (keys) => {
        const candidate = createStoreKitEntitlementCatalog(
          keys.map((key) => PRODUCTS[key as keyof typeof PRODUCTS]),
        );
        expect(candidate.isOk() && candidate.value.id).toBe(expected.value.id);
      },
    ),
  );
});

test("every generated positive safe sequence parses", () => {
  assert(
    property(integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), (sequence) => {
      expect(parseStoreKitSequence(sequence).isOk()).toBe(true);
    }),
  );
});
