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
  isVerifiedStoreKitEntitlementFact,
  parseStoreKitSequence,
  storeKitSequenceSchema,
  storeKitFactFingerprint,
  type StoreKitSequence,
  type VerifiedStoreKitEntitlementFact,
} from "./facts";
import {
  storeKitProductIdSchema,
  type StoreKitProductId,
  type StoreKitProductPolicy,
  type StoreKitProductType,
} from "./policy";
import { isAfter, parseISO } from "date-fns";
import { uniqBy } from "es-toolkit";
import { match } from "ts-pattern";
import { z } from "zod";

export interface StoreKitStartupEntitlementCache {
  readonly productId: StoreKitProductId;
  readonly verifiedAt: IsoTimestamp;
  readonly wasEntitled: boolean;
}

export type StoreKitEntitlementAuthority =
  | Readonly<{ kind: "unknown" }>
  | Readonly<{
      evaluatedAt: IsoTimestamp;
      expiresAt: IsoTimestamp | null;
      kind: "entitled";
      productId: StoreKitProductId;
      productType: StoreKitProductType;
      verifiedAt: IsoTimestamp;
    }>
  | Readonly<{
      evaluatedAt: IsoTimestamp;
      kind: "not_entitled";
      reason: "expired" | "no_current_entitlement" | "refunded" | "revoked";
      verifiedAt: IsoTimestamp;
    }>
  | Readonly<{
      observedAt: IsoTimestamp;
      reason: "offline" | "store_unavailable";
      kind: "unavailable";
    }>;

export const storeKitSnapshotSourceSchema = z.enum(["account_change", "launch", "restore"]);
export type StoreKitSnapshotSource = z.infer<typeof storeKitSnapshotSourceSchema>;

const runtimeStoreKitEntitlementEventBrand: unique symbol = Symbol(
  "RuntimeStoreKitEntitlementEvent",
);
const runtimeStoreKitEntitlementEvents = new WeakSet<object>();

interface RuntimeStoreKitEntitlementEvent {
  readonly [runtimeStoreKitEntitlementEventBrand]: true;
}

export type StoreKitEntitlementSnapshotEvent = Readonly<{
  facts: readonly VerifiedStoreKitEntitlementFact[];
  observedAt: IsoTimestamp;
  sequence: StoreKitSequence;
  source: StoreKitSnapshotSource;
  type: "snapshot";
}> &
  RuntimeStoreKitEntitlementEvent;

export type StoreKitEntitlementTransactionEvent = Readonly<{
  fact: VerifiedStoreKitEntitlementFact;
  type: "transaction";
}> &
  RuntimeStoreKitEntitlementEvent;

export type StoreKitUnavailableEvent = Readonly<{
  observedAt: IsoTimestamp;
  reason: "offline" | "store_unavailable";
  sequence: StoreKitSequence;
  type: "unavailable";
}> &
  RuntimeStoreKitEntitlementEvent;

export type StoreKitEntitlementEvent =
  | StoreKitEntitlementSnapshotEvent
  | StoreKitEntitlementTransactionEvent
  | StoreKitUnavailableEvent;

const startupCacheSchema = z.strictObject({
  productId: storeKitProductIdSchema,
  verifiedAt: isoTimestampSchema,
  wasEntitled: z.boolean(),
});
const nativeSnapshotShapeSchema = z.strictObject({
  facts: z.array(z.unknown()),
  observedAt: isoTimestampSchema,
  sequence: storeKitSequenceSchema,
  source: storeKitSnapshotSourceSchema,
});
const nativeUnavailableEventShapeSchema = z.strictObject({
  observedAt: isoTimestampSchema,
  reason: z.enum(["offline", "store_unavailable"]),
  sequence: storeKitSequenceSchema,
});

function issueRuntimeStoreKitEntitlementEvent<T extends object>(
  event: T,
): T & RuntimeStoreKitEntitlementEvent {
  Object.defineProperty(event, runtimeStoreKitEntitlementEventBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  const issuedEvent = Object.freeze(event) as T & RuntimeStoreKitEntitlementEvent;
  runtimeStoreKitEntitlementEvents.add(issuedEvent);
  return issuedEvent;
}

export function isRuntimeStoreKitEntitlementEvent(
  input: unknown,
): input is StoreKitEntitlementEvent {
  return (
    typeof input === "object" &&
    input !== null &&
    runtimeStoreKitEntitlementEvents.has(input) &&
    (input as { readonly [runtimeStoreKitEntitlementEventBrand]?: unknown })[
      runtimeStoreKitEntitlementEventBrand
    ] === true
  );
}

export function parseStoreKitStartupEntitlementCache(
  input: unknown,
  policy: StoreKitProductPolicy,
): Result<StoreKitStartupEntitlementCache, LenaError> {
  const record = startupCacheSchema.safeParse(input);
  if (!record.success) {
    return err(
      new LenaError("invalid_input", "Cached StoreKit entitlement is invalid", {
        boundary: "storekit_startup_cache",
      }),
    );
  }

  if (record.data.productId !== policy.productId) {
    return err(
      new LenaError("invalid_input", "Cached StoreKit product does not match", {
        boundary: "storekit_startup_cache",
      }),
    );
  }
  const verifiedAt = parseIsoTimestamp(record.data.verifiedAt);
  if (verifiedAt.isErr()) {
    return err(verifiedAt.error);
  }
  return ok(
    Object.freeze({
      productId: policy.productId,
      verifiedAt: verifiedAt.value,
      wasEntitled: record.data.wasEntitled,
    }),
  );
}

/**
 * Internal trust boundary for a future native StoreKit adapter.
 *
 * This function is intentionally omitted from the package root. Application
 * code must never turn cached or caller-supplied facts into live authority.
 */
export function createStoreKitTransactionEventFromNativeAdapter(
  fact: unknown,
): Result<StoreKitEntitlementTransactionEvent, LenaError> {
  if (!isVerifiedStoreKitEntitlementFact(fact)) {
    return err(
      new LenaError("authentication_required", "StoreKit fact lacks native verification", {
        boundary: "storekit_transaction_event",
      }),
    );
  }
  return ok(issueRuntimeStoreKitEntitlementEvent({ fact, type: "transaction" as const }));
}

/**
 * Internal trust boundary for a future native StoreKit adapter.
 *
 * The adapter owns the positive monotonic sequence. This function is
 * intentionally omitted from the package root because a snapshot supersedes
 * older live events and is therefore authorizing evidence.
 */
export function createStoreKitEntitlementSnapshotFromNativeAdapter(
  input: unknown,
): Result<StoreKitEntitlementSnapshotEvent, LenaError> {
  const record = nativeSnapshotShapeSchema.safeParse(input);
  if (!record.success) {
    return err(
      new LenaError("invalid_input", "StoreKit snapshot facts are invalid", {
        boundary: "storekit_snapshot",
      }),
    );
  }

  const sequence = parseStoreKitSequence(record.data.sequence);
  if (sequence.isErr()) {
    return err(sequence.error);
  }
  const observedAt = parseIsoTimestamp(record.data.observedAt);
  if (observedAt.isErr()) {
    return err(observedAt.error);
  }
  const facts: VerifiedStoreKitEntitlementFact[] = [];
  for (const fact of record.data.facts) {
    if (!isVerifiedStoreKitEntitlementFact(fact)) {
      return err(
        new LenaError("authentication_required", "Snapshot contains an unverified StoreKit fact", {
          boundary: "storekit_snapshot",
        }),
      );
    }
    if (fact.sequence >= sequence.value) {
      return err(
        new LenaError("invalid_input", "Snapshot sequence must follow all of its StoreKit facts", {
          boundary: "storekit_snapshot",
        }),
      );
    }
    if (isAfter(parseISO(fact.observedAt), parseISO(observedAt.value))) {
      return err(
        new LenaError("invalid_input", "Snapshot observation predates one of its facts", {
          boundary: "storekit_snapshot",
        }),
      );
    }
    facts.push(fact);
  }
  if (uniqBy(facts, (fact) => fact.productId).length !== facts.length) {
    return err(
      new LenaError("conflict", "Snapshot contains duplicate StoreKit products", {
        boundary: "storekit_snapshot",
      }),
    );
  }
  if (uniqBy(facts, (fact) => fact.sequence).length !== facts.length) {
    return err(
      new LenaError("conflict", "Snapshot contains duplicate StoreKit sequences", {
        boundary: "storekit_snapshot",
      }),
    );
  }

  return ok(
    issueRuntimeStoreKitEntitlementEvent({
      facts: Object.freeze(facts),
      observedAt: observedAt.value,
      sequence: sequence.value,
      source: record.data.source,
      type: "snapshot" as const,
    }),
  );
}

/**
 * Internal trust boundary for a future native StoreKit adapter.
 *
 * Unavailability is non-granting, but its sequence participates in the same
 * ordered stream. It is intentionally omitted from the package root.
 */
export function createStoreKitUnavailableEventFromNativeAdapter(
  input: unknown,
): Result<StoreKitUnavailableEvent, LenaError> {
  const record = nativeUnavailableEventShapeSchema.safeParse(input);
  if (!record.success) {
    return err(
      new LenaError("invalid_input", "StoreKit unavailable event is invalid", {
        boundary: "storekit_unavailable_event",
      }),
    );
  }

  const sequence = parseStoreKitSequence(record.data.sequence);
  if (sequence.isErr()) {
    return err(sequence.error);
  }
  const observedAt = parseIsoTimestamp(record.data.observedAt);
  if (observedAt.isErr()) {
    return err(observedAt.error);
  }
  return ok(
    issueRuntimeStoreKitEntitlementEvent({
      observedAt: observedAt.value,
      reason: record.data.reason,
      sequence: sequence.value,
      type: "unavailable" as const,
    }),
  );
}

export function parseStoreKitEntitlementEvent(
  input: unknown,
): Result<StoreKitEntitlementEvent, LenaError> {
  if (isRuntimeStoreKitEntitlementEvent(input)) {
    return ok(input);
  }

  return err(
    new LenaError("authentication_required", "StoreKit event lacks native adapter authority", {
      boundary: "storekit_entitlement_event",
    }),
  );
}

export function storeKitEntitlementEventSequence(
  event: StoreKitEntitlementEvent,
): StoreKitSequence {
  return match(event)
    .with({ type: "transaction" }, ({ fact }) => fact.sequence)
    .with({ type: "snapshot" }, ({ sequence }) => sequence)
    .with({ type: "unavailable" }, ({ sequence }) => sequence)
    .exhaustive();
}

export function storeKitEntitlementEventFingerprint(event: StoreKitEntitlementEvent): string {
  return match(event)
    .with({ type: "transaction" }, ({ fact }) =>
      JSON.stringify(["transaction-v1", storeKitFactFingerprint(fact)]),
    )
    .with({ type: "unavailable" }, ({ observedAt, reason, sequence }) =>
      JSON.stringify(["unavailable-v1", sequence, observedAt, reason]),
    )
    .with({ type: "snapshot" }, ({ facts, observedAt, sequence, source }) =>
      JSON.stringify([
        "snapshot-v1",
        sequence,
        observedAt,
        source,
        facts.map(storeKitFactFingerprint).toSorted(),
      ]),
    )
    .exhaustive();
}
