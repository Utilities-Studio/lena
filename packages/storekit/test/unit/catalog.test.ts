import { describe, expect, test } from "bun:test";

import {
  createInitialStoreKitCatalogEntitlementState,
  createStoreKitEntitlementCatalog,
  createStoreKitProductPolicy,
  evaluateStoreKitCatalogEntitlement,
  hasStoreKitCatalogPaidAccess,
  reduceStoreKitCatalogEntitlement,
  reduceStoreKitCatalogEntitlementEvents,
  type StoreKitEntitlementCatalog,
  type StoreKitEntitlementEvent,
  type StoreKitProductPolicy,
  type VerifiedStoreKitEntitlementFact,
} from "../../src/index";
import {
  createStoreKitEntitlementSnapshotFromNativeAdapter,
  createStoreKitTransactionEventFromNativeAdapter,
  createStoreKitUnavailableEventFromNativeAdapter,
} from "../../src/entitlement";
import { createVerifiedStoreKitEntitlementFactFromNativeAdapter } from "../../src/facts";

const LIFETIME_PRODUCT = "studio.utilities.jetseen.lifetime";
const ANNUAL_PRODUCT = "studio.utilities.jetseen.annual";
const OTHER_PRODUCT = "studio.utilities.jetseen.other";

function policy(
  productId: string,
  productType: "auto-renewable-subscription" | "non-consumable",
): StoreKitProductPolicy {
  const result = createStoreKitProductPolicy(productId, productType);
  if (result.isErr()) throw result.error;
  return result.value;
}

function policies(): Readonly<{
  annual: StoreKitProductPolicy;
  lifetime: StoreKitProductPolicy;
}> {
  return {
    annual: policy(ANNUAL_PRODUCT, "auto-renewable-subscription"),
    lifetime: policy(LIFETIME_PRODUCT, "non-consumable"),
  };
}

function catalog(
  input: readonly StoreKitProductPolicy[] = Object.values(policies()),
): StoreKitEntitlementCatalog {
  const result = createStoreKitEntitlementCatalog(input);
  if (result.isErr()) throw result.error;
  return result.value;
}

function fact(
  productPolicy: StoreKitProductPolicy,
  sequence: number,
  overrides: Readonly<Record<string, unknown>> = {},
): VerifiedStoreKitEntitlementFact {
  const subscription = productPolicy.productType === "auto-renewable-subscription";
  const result = createVerifiedStoreKitEntitlementFactFromNativeAdapter(
    {
      disposition: "active",
      effectiveAt: `2026-09-${String(sequence).padStart(2, "0")}T08:00:00.000Z`,
      expiresAt: subscription ? "2027-09-01T08:00:00.000Z" : null,
      observedAt: `2026-09-${String(sequence).padStart(2, "0")}T08:01:00.000Z`,
      productId: productPolicy.productId,
      sequence,
      source: "transaction_update",
      ...overrides,
    },
    productPolicy,
  );
  if (result.isErr()) throw result.error;
  return result.value;
}

function transaction(factValue: VerifiedStoreKitEntitlementFact): StoreKitEntitlementEvent {
  const result = createStoreKitTransactionEventFromNativeAdapter(factValue);
  if (result.isErr()) throw result.error;
  return result.value;
}

function snapshot(
  sequence: number,
  facts: readonly VerifiedStoreKitEntitlementFact[],
  observedAt = `2026-09-${String(sequence).padStart(2, "0")}T09:00:00.000Z`,
): StoreKitEntitlementEvent {
  const result = createStoreKitEntitlementSnapshotFromNativeAdapter({
    facts,
    observedAt,
    sequence,
    source: "launch",
  });
  if (result.isErr()) throw result.error;
  return result.value;
}

function reduce(events: readonly StoreKitEntitlementEvent[], entitlementCatalog = catalog()) {
  const result = reduceStoreKitCatalogEntitlementEvents(
    createInitialStoreKitCatalogEntitlementState(entitlementCatalog),
    events,
    entitlementCatalog,
  );
  if (result.isErr()) throw result.error;
  return result.value;
}

function paid(
  state: ReturnType<typeof createInitialStoreKitCatalogEntitlementState>,
  entitlementCatalog: StoreKitEntitlementCatalog,
  asOf: string,
): boolean {
  const result = hasStoreKitCatalogPaidAccess(state, entitlementCatalog, asOf);
  if (result.isErr()) throw result.error;
  return result.value;
}

describe("exact catalog and catalog identity", () => {
  test("has deterministic identity independent of input order", () => {
    const { annual, lifetime } = policies();
    expect(catalog([annual, lifetime]).id).toBe(catalog([lifetime, annual]).id);
  });

  test("rejects duplicate, malformed, and missing product types", () => {
    const { lifetime } = policies();
    expect(createStoreKitEntitlementCatalog([lifetime, lifetime]).isOk()).toBe(false);
    expect(
      createStoreKitEntitlementCatalog([
        { productId: LIFETIME_PRODUCT, productType: undefined },
      ]).isOk(),
    ).toBe(false);
    expect(
      createStoreKitEntitlementCatalog([
        { productId: LIFETIME_PRODUCT, productType: "consumable" },
      ]).isOk(),
    ).toBe(false);
  });

  test("rejects state reuse across catalog changes and supports explicit reinitialization", () => {
    const original = catalog();
    const changed = catalog([
      ...Object.values(policies()),
      policy(OTHER_PRODUCT, "non-consumable"),
    ]);
    const state = createInitialStoreKitCatalogEntitlementState(original);
    const event = transaction(fact(policies().lifetime, 1));
    expect(reduceStoreKitCatalogEntitlement(state, event, changed).isOk()).toBe(false);
    expect(
      evaluateStoreKitCatalogEntitlement(state, changed, "2026-09-01T09:00:00.000Z").isOk(),
    ).toBe(false);
    expect(
      reduceStoreKitCatalogEntitlement(
        createInitialStoreKitCatalogEntitlementState(changed),
        event,
        changed,
      ).isOk(),
    ).toBe(true);
  });

  test("rejects an opaque fact for a product outside the exact allowlist", () => {
    const configuredCatalog = catalog();
    const other = policy(OTHER_PRODUCT, "non-consumable");
    const state = createInitialStoreKitCatalogEntitlementState(configuredCatalog);
    const result = reduceStoreKitCatalogEntitlement(
      state,
      transaction(fact(other, 1)),
      configuredCatalog,
    );
    expect(result.isOk()).toBe(false);
  });
});

describe("monotonic sequence and deterministic reduction", () => {
  test("preserves a newer transaction when a stale snapshot arrives later", () => {
    const configuredCatalog = catalog();
    const lifetimeActive = transaction(fact(policies().lifetime, 20));
    const staleEmptySnapshot = snapshot(10, [], "2026-09-10T09:00:00.000Z");

    const transactionFirst = reduce([lifetimeActive, staleEmptySnapshot], configuredCatalog);
    const snapshotFirst = reduce([staleEmptySnapshot, lifetimeActive], configuredCatalog);
    expect(transactionFirst).toEqual(snapshotFirst);
    expect(paid(transactionFirst, configuredCatalog, "2026-09-20T10:00:00.000Z")).toBe(true);
  });

  test("a newer complete snapshot clears older transactions and blocks stale replay", () => {
    const configuredCatalog = catalog();
    const lifetimeActive = transaction(fact(policies().lifetime, 20));
    const newerEmptySnapshot = snapshot(30, [], "2026-09-30T09:00:00.000Z");
    const denied = reduce([lifetimeActive, newerEmptySnapshot], configuredCatalog);
    expect(paid(denied, configuredCatalog, "2026-09-30T10:00:00.000Z")).toBe(false);

    const replay = reduceStoreKitCatalogEntitlement(denied, lifetimeActive, configuredCatalog);
    if (replay.isErr()) throw replay.error;
    expect(replay.value).toBe(denied);
  });

  test("live permutations and batch reduction converge for cross-product events", () => {
    const configuredCatalog = catalog();
    const { annual, lifetime } = policies();
    const events = [
      snapshot(10, [], "2026-09-10T09:00:00.000Z"),
      transaction(fact(lifetime, 20)),
      transaction(
        fact(annual, 15, {
          effectiveAt: "2026-09-15T08:00:00.000Z",
          observedAt: "2026-09-15T08:01:00.000Z",
        }),
      ),
    ];
    const ascending = reduce(events, configuredCatalog);
    const descending = reduce(events.toReversed(), configuredCatalog);

    let live = createInitialStoreKitCatalogEntitlementState(configuredCatalog);
    for (const event of events.toReversed()) {
      const next = reduceStoreKitCatalogEntitlement(live, event, configuredCatalog);
      if (next.isErr()) throw next.error;
      live = next.value;
    }
    expect(descending).toEqual(ascending);
    expect(live).toEqual(ascending);
  });

  test("is idempotent for exact duplicates and rejects sequence collisions", () => {
    const configuredCatalog = catalog();
    const lifetimeEvent = transaction(fact(policies().lifetime, 1));
    const first = reduceStoreKitCatalogEntitlement(
      createInitialStoreKitCatalogEntitlementState(configuredCatalog),
      lifetimeEvent,
      configuredCatalog,
    );
    if (first.isErr()) throw first.error;
    const duplicate = reduceStoreKitCatalogEntitlement(
      first.value,
      lifetimeEvent,
      configuredCatalog,
    );
    expect(duplicate.isOk() && duplicate.value).toBe(first.value);

    const annualAtSameSequence = transaction(fact(policies().annual, 1));
    const collision = reduceStoreKitCatalogEntitlement(
      first.value,
      annualAtSameSequence,
      configuredCatalog,
    );
    expect(collision.isOk()).toBe(false);
  });

  test("rejects snapshots that do not follow their facts", () => {
    const lifetimeFact = fact(policies().lifetime, 5);
    expect(
      createStoreKitEntitlementSnapshotFromNativeAdapter({
        facts: [lifetimeFact],
        observedAt: "2026-09-05T09:00:00.000Z",
        sequence: 5,
        source: "launch",
      }).isOk(),
    ).toBe(false);
    expect(
      createStoreKitEntitlementSnapshotFromNativeAdapter({
        facts: [lifetimeFact],
        observedAt: "2026-09-05T08:00:00.000Z",
        sequence: 6,
        source: "launch",
      }).isOk(),
    ).toBe(false);
  });

  test("rejects caller-minted snapshot resurrection while adapter sequence 3 stays deterministic", () => {
    const configuredCatalog = catalog();
    const lifetime = policies().lifetime;
    const activeFact = fact(lifetime, 1);
    const revokedFact = fact(lifetime, 2, {
      disposition: "revoked",
      effectiveAt: "2026-09-02T08:00:00.000Z",
      observedAt: "2026-09-02T08:01:00.000Z",
    });
    const activeEvent = transaction(activeFact);
    const revokedEvent = transaction(revokedFact);
    const revokedState = reduce([activeEvent, revokedEvent], configuredCatalog);
    expect(paid(revokedState, configuredCatalog, "2026-09-02T10:00:00.000Z")).toBe(false);

    const callerRewrittenState = {
      ...revokedState,
      currentFacts: [activeFact],
    } as unknown as ReturnType<typeof createInitialStoreKitCatalogEntitlementState>;
    expect(
      evaluateStoreKitCatalogEntitlement(
        callerRewrittenState,
        configuredCatalog,
        "2026-09-02T10:00:00.000Z",
      ).isOk(),
    ).toBe(false);
    const serializedState = JSON.parse(JSON.stringify(revokedState)) as ReturnType<
      typeof createInitialStoreKitCatalogEntitlementState
    >;
    expect(
      evaluateStoreKitCatalogEntitlement(
        serializedState,
        configuredCatalog,
        "2026-09-02T10:00:00.000Z",
      ).isOk(),
    ).toBe(false);

    const callerMintedSnapshot = {
      facts: [activeFact],
      observedAt: "2026-09-03T09:00:00.000Z",
      sequence: 3,
      source: "launch",
      type: "snapshot",
    } as unknown as StoreKitEntitlementEvent;
    const forgedReduction = reduceStoreKitCatalogEntitlement(
      revokedState,
      callerMintedSnapshot,
      configuredCatalog,
    );
    expect(forgedReduction.isOk()).toBe(false);

    const adapterSnapshot = snapshot(3, [], "2026-09-03T09:00:00.000Z");
    const spreadSnapshot = { ...adapterSnapshot } as unknown as StoreKitEntitlementEvent;
    const serializedSnapshot = JSON.parse(
      JSON.stringify(adapterSnapshot),
    ) as StoreKitEntitlementEvent;
    expect(
      reduceStoreKitCatalogEntitlement(revokedState, spreadSnapshot, configuredCatalog).isOk(),
    ).toBe(false);
    expect(
      reduceStoreKitCatalogEntitlement(revokedState, serializedSnapshot, configuredCatalog).isOk(),
    ).toBe(false);

    const chronological = reduce([activeEvent, revokedEvent, adapterSnapshot], configuredCatalog);
    const outOfOrder = reduce([adapterSnapshot, revokedEvent, activeEvent], configuredCatalog);
    expect(outOfOrder).toEqual(chronological);
    expect(paid(chronological, configuredCatalog, "2026-09-03T10:00:00.000Z")).toBe(false);
  });
});

describe("multi-product authority and offline expiry", () => {
  test("annual expiration, refund, and revocation cannot revoke active lifetime", () => {
    const configuredCatalog = catalog();
    const { annual, lifetime } = policies();
    for (const disposition of ["expired", "refunded", "revoked"] as const) {
      const lifetimeActive = fact(lifetime, 1);
      const annualTerminal = fact(annual, 2, {
        disposition,
        effectiveAt: "2026-09-02T08:00:00.000Z",
        expiresAt: "2026-09-02T08:00:00.000Z",
        observedAt: "2026-09-02T08:01:00.000Z",
      });
      const state = reduce(
        [snapshot(3, [lifetimeActive, annualTerminal], "2026-09-03T09:00:00.000Z")],
        configuredCatalog,
      );
      const authority = evaluateStoreKitCatalogEntitlement(
        state,
        configuredCatalog,
        "2026-09-03T10:00:00.000Z",
      );
      expect(authority.isOk() && authority.value).toMatchObject({
        kind: "entitled",
        productId: LIFETIME_PRODUCT,
      });
    }
  });

  test("expires an annual entitlement from verified expiresAt while offline", () => {
    const configuredCatalog = catalog();
    const annualActive = transaction(
      fact(policies().annual, 1, {
        expiresAt: "2026-09-10T08:00:00.000Z",
      }),
    );
    const unavailable = createStoreKitUnavailableEventFromNativeAdapter({
      observedAt: "2026-09-10T09:00:00.000Z",
      reason: "offline",
      sequence: 2,
    });
    if (unavailable.isErr()) throw unavailable.error;
    const onlineState = reduce([annualActive], configuredCatalog);
    expect(paid(onlineState, configuredCatalog, "2026-09-09T09:00:00.000Z")).toBe(true);

    const state = reduce([annualActive, unavailable.value], configuredCatalog);
    expect(paid(state, configuredCatalog, "2026-09-10T09:00:00.000Z")).toBe(false);
    const authority = evaluateStoreKitCatalogEntitlement(
      state,
      configuredCatalog,
      "2026-09-10T09:00:00.000Z",
    );
    expect(authority.isOk() && authority.value).toMatchObject({
      kind: "not_entitled",
      reason: "expired",
    });
  });

  test("keeps verified lifetime access offline but fails closed without verified state", () => {
    const configuredCatalog = catalog();
    const unavailable = createStoreKitUnavailableEventFromNativeAdapter({
      observedAt: "2026-09-02T09:00:00.000Z",
      reason: "offline",
      sequence: 2,
    });
    if (unavailable.isErr()) throw unavailable.error;
    const lifetimeState = reduce(
      [transaction(fact(policies().lifetime, 1)), unavailable.value],
      configuredCatalog,
    );
    expect(paid(lifetimeState, configuredCatalog, "2026-09-02T10:00:00.000Z")).toBe(true);

    const unavailableOnly = reduce([unavailable.value], configuredCatalog);
    expect(paid(unavailableOnly, configuredCatalog, "2026-09-02T10:00:00.000Z")).toBe(false);
    const authority = evaluateStoreKitCatalogEntitlement(
      unavailableOnly,
      configuredCatalog,
      "2026-09-02T10:00:00.000Z",
    );
    expect(authority.isOk() && authority.value.kind).toBe("unavailable");
  });

  test("rejects an as-of time that predates observed authority state", () => {
    const configuredCatalog = catalog();
    const state = reduce([transaction(fact(policies().lifetime, 1))], configuredCatalog);
    expect(
      hasStoreKitCatalogPaidAccess(state, configuredCatalog, "2026-09-01T07:00:00.000Z").isOk(),
    ).toBe(false);
  });
});
