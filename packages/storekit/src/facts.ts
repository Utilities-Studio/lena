import {
  err,
  isoTimestampSchema,
  LenaError,
  ok,
  parseIsoTimestamp,
  type IsoTimestamp,
  type Result,
} from "@lena/core";

import {
  parseStoreKitProductId,
  storeKitProductIdSchema,
  type StoreKitProductId,
  type StoreKitProductPolicy,
} from "./policy";
import { isAfter, isBefore, parseISO } from "date-fns";
import { z } from "zod";

export const storeKitSequenceSchema = z
  .number()
  .int()
  .safe()
  .positive()
  .brand<"StoreKitSequence">();
export const storeKitEntitlementDispositionSchema = z.enum([
  "active",
  "expired",
  "refunded",
  "revoked",
]);
export const storeKitFactSourceSchema = z.enum(["launch", "restore", "transaction_update"]);

export type StoreKitSequence = z.infer<typeof storeKitSequenceSchema>;
export type StoreKitEntitlementDisposition = z.infer<typeof storeKitEntitlementDispositionSchema>;
export type StoreKitFactSource = z.infer<typeof storeKitFactSourceSchema>;

const verifiedStoreKitFactBrand: unique symbol = Symbol("VerifiedStoreKitEntitlementFact");
const verifiedStoreKitFacts = new WeakSet<object>();

export interface VerifiedStoreKitEntitlementFact {
  readonly [verifiedStoreKitFactBrand]: true;
  readonly disposition: StoreKitEntitlementDisposition;
  readonly effectiveAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp | null;
  readonly observedAt: IsoTimestamp;
  readonly productId: StoreKitProductId;
  readonly sequence: StoreKitSequence;
  readonly source: StoreKitFactSource;
}

const nativeVerifiedFactShapeSchema = z.strictObject({
  disposition: storeKitEntitlementDispositionSchema,
  effectiveAt: isoTimestampSchema,
  expiresAt: z.unknown().optional(),
  observedAt: isoTimestampSchema,
  productId: storeKitProductIdSchema,
  sequence: storeKitSequenceSchema,
  source: storeKitFactSourceSchema,
});

export function parseStoreKitSequence(value: unknown): Result<StoreKitSequence, LenaError> {
  const parsed = storeKitSequenceSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      new LenaError("invalid_input", "StoreKit sequence must be a positive safe integer", {
        boundary: "storekit_sequence",
      }),
    );
  }

  return ok(parsed.data);
}

export function isVerifiedStoreKitEntitlementFact(
  input: unknown,
): input is VerifiedStoreKitEntitlementFact {
  return (
    typeof input === "object" &&
    input !== null &&
    verifiedStoreKitFacts.has(input) &&
    (input as { readonly [verifiedStoreKitFactBrand]?: unknown })[verifiedStoreKitFactBrand] ===
      true
  );
}

/**
 * Internal trust boundary for a future native StoreKit adapter.
 *
 * This function must only receive fields from a successful native
 * VerificationResult. It is intentionally omitted from the package root.
 */
export function createVerifiedStoreKitEntitlementFactFromNativeAdapter(
  input: unknown,
  policy: StoreKitProductPolicy,
): Result<VerifiedStoreKitEntitlementFact, LenaError> {
  const record = nativeVerifiedFactShapeSchema.safeParse(input);
  if (!record.success) {
    return err(
      new LenaError("invalid_input", "Verified StoreKit fact is invalid", {
        boundary: "storekit_native_verified_fact",
      }),
    );
  }

  const productId = parseStoreKitProductId(record.data.productId);
  if (productId.isErr()) {
    return err(productId.error);
  }
  if (productId.value !== policy.productId) {
    return err(
      new LenaError("invalid_input", "StoreKit product does not match policy", {
        boundary: "storekit_native_verified_fact",
        reason: "wrong_product",
      }),
    );
  }

  const sequence = parseStoreKitSequence(record.data.sequence);
  if (sequence.isErr()) {
    return err(sequence.error);
  }
  const effectiveAt = parseIsoTimestamp(record.data.effectiveAt);
  if (effectiveAt.isErr()) {
    return err(effectiveAt.error);
  }
  const observedAt = parseIsoTimestamp(record.data.observedAt);
  if (observedAt.isErr()) {
    return err(observedAt.error);
  }
  if (isBefore(parseISO(observedAt.value), parseISO(effectiveAt.value))) {
    return err(
      new LenaError("invalid_input", "StoreKit fact predates its effect", {
        boundary: "storekit_native_verified_fact",
      }),
    );
  }

  const disposition = record.data.disposition;

  let expiresAt: IsoTimestamp | null = null;
  if (policy.productType === "auto-renewable-subscription") {
    const parsedExpiration = parseIsoTimestamp(record.data.expiresAt);
    if (parsedExpiration.isErr()) {
      return err(
        new LenaError("invalid_input", "A subscription fact requires a valid expiration", {
          boundary: "storekit_native_verified_fact",
        }),
      );
    }
    if (
      disposition === "active" &&
      !isAfter(parseISO(parsedExpiration.value), parseISO(effectiveAt.value))
    ) {
      return err(
        new LenaError("invalid_input", "An active subscription must expire after its effect", {
          boundary: "storekit_native_verified_fact",
        }),
      );
    }
    if (
      disposition === "expired" &&
      isAfter(parseISO(parsedExpiration.value), parseISO(effectiveAt.value))
    ) {
      return err(
        new LenaError("invalid_input", "A subscription cannot expire before its expiration", {
          boundary: "storekit_native_verified_fact",
        }),
      );
    }
    expiresAt = parsedExpiration.value;
  } else {
    if (disposition === "expired") {
      return err(
        new LenaError("invalid_input", "A non-consumable product cannot expire", {
          boundary: "storekit_native_verified_fact",
        }),
      );
    }
    if (record.data.expiresAt !== undefined && record.data.expiresAt !== null) {
      return err(
        new LenaError("invalid_input", "A non-consumable fact cannot have an expiration", {
          boundary: "storekit_native_verified_fact",
        }),
      );
    }
  }

  const fact = {
    disposition,
    effectiveAt: effectiveAt.value,
    expiresAt,
    observedAt: observedAt.value,
    productId: productId.value,
    sequence: sequence.value,
    source: record.data.source,
  } as Record<PropertyKey, unknown>;
  Object.defineProperty(fact, verifiedStoreKitFactBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  const verifiedFact = Object.freeze(fact) as unknown as VerifiedStoreKitEntitlementFact;
  verifiedStoreKitFacts.add(verifiedFact);
  return ok(verifiedFact);
}

export function compareVerifiedStoreKitFacts(
  left: VerifiedStoreKitEntitlementFact,
  right: VerifiedStoreKitEntitlementFact,
): number {
  if (left.sequence === right.sequence) {
    return 0;
  }
  return left.sequence < right.sequence ? -1 : 1;
}

export function selectLatestStoreKitFact(
  facts: readonly VerifiedStoreKitEntitlementFact[],
): VerifiedStoreKitEntitlementFact | null {
  let latest: VerifiedStoreKitEntitlementFact | null = null;
  for (const fact of facts) {
    if (latest === null || fact.sequence > latest.sequence) {
      latest = fact;
    }
  }
  return latest;
}

export function storeKitFactFingerprint(fact: VerifiedStoreKitEntitlementFact): string {
  return JSON.stringify([
    "fact-v1",
    fact.sequence,
    fact.productId,
    fact.disposition,
    fact.effectiveAt,
    fact.observedAt,
    fact.expiresAt,
    fact.source,
  ]);
}
