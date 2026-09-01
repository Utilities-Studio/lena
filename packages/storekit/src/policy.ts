import { err, LenaError, ok, type Result } from "@lena/core";
import { z } from "zod";

const PRODUCT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export const storeKitProductIdSchema = z
  .string()
  .regex(PRODUCT_ID_PATTERN)
  .brand<"StoreKitProductId">();
export const storeKitProductTypeSchema = z.enum(["auto-renewable-subscription", "non-consumable"]);

export type StoreKitProductId = z.infer<typeof storeKitProductIdSchema>;
export type StoreKitProductType = z.infer<typeof storeKitProductTypeSchema>;

export interface StoreKitProductPolicy {
  readonly productId: StoreKitProductId;
  readonly productType: StoreKitProductType;
}

export function parseStoreKitProductId(value: unknown): Result<StoreKitProductId, LenaError> {
  const parsed = storeKitProductIdSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      new LenaError("invalid_input", "StoreKit product identifier is invalid", {
        boundary: "storekit_product_policy",
      }),
    );
  }

  return ok(parsed.data);
}

export function createStoreKitProductPolicy(
  productId: unknown,
  productType: unknown,
): Result<StoreKitProductPolicy, LenaError> {
  const parsed = parseStoreKitProductId(productId);
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const parsedProductType = storeKitProductTypeSchema.safeParse(productType);
  if (!parsedProductType.success) {
    return err(
      new LenaError("invalid_input", "StoreKit product type is invalid", {
        boundary: "storekit_product_policy",
      }),
    );
  }

  return ok(
    Object.freeze({
      productId: parsed.value,
      productType: parsedProductType.data,
    }),
  );
}
