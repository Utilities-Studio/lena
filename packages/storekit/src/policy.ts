import { err, LenaError, ok, type Result } from "@lena/core";
import { z } from "zod";

const PRODUCT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export const storeKitProductIdSchema = z
  .string()
  .regex(PRODUCT_ID_PATTERN)
  .brand<"StoreKitProductId">();
export const storeKitProductTypeSchema = z.enum(["auto-renewable-subscription", "non-consumable"]);
export const storeKitProductPolicySchema = z
  .strictObject({
    productId: storeKitProductIdSchema,
    productType: storeKitProductTypeSchema,
  })
  .readonly();

export type StoreKitProductId = z.infer<typeof storeKitProductIdSchema>;
export type StoreKitProductType = z.infer<typeof storeKitProductTypeSchema>;
export type StoreKitProductPolicy = z.infer<typeof storeKitProductPolicySchema>;

export function parseStoreKitProductId(value: unknown): Result<StoreKitProductId, LenaError> {
  const parsed = storeKitProductIdSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      new LenaError("invalid_input", {
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
  const parsed = storeKitProductPolicySchema.safeParse({ productId, productType });
  if (!parsed.success) {
    return err(
      new LenaError("invalid_input", {
        boundary: "storekit_product_policy",
      }),
    );
  }
  return ok(parsed.data);
}
