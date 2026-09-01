import {
  compareIsoTimestamps,
  err,
  LenaError,
  ok,
  parseIsoTimestamp,
  type IsoTimestamp,
  type Result,
} from "@lena/core";

import {
  parseStoreKitEntitlementEvent,
  storeKitEntitlementEventFingerprint,
  storeKitEntitlementEventSequence,
  type StoreKitEntitlementAuthority,
  type StoreKitEntitlementEvent,
  type StoreKitUnavailableEvent,
} from "./entitlement";
import {
  isVerifiedStoreKitEntitlementFact,
  selectLatestStoreKitFact,
  type StoreKitSequence,
  type VerifiedStoreKitEntitlementFact,
} from "./facts";
import {
  createStoreKitProductPolicy,
  type StoreKitProductId,
  type StoreKitProductPolicy,
} from "./policy";
import { isBefore, parseISO } from "date-fns";
import { groupBy, maxBy, orderBy } from "es-toolkit";
import { match } from "ts-pattern";
import { z } from "zod";

declare const catalogIdBrand: unique symbol;

export type StoreKitCatalogId = string & {
  readonly [catalogIdBrand]: "StoreKitCatalogId";
};

export interface StoreKitEntitlementCatalog {
  readonly id: StoreKitCatalogId;
  readonly products: readonly StoreKitProductPolicy[];
}

interface StoreKitSnapshotPosition {
  readonly observedAt: IsoTimestamp;
  readonly sequence: StoreKitSequence;
}

interface ProcessedStoreKitEvent {
  readonly fingerprint: string;
  readonly sequence: StoreKitSequence;
}

const runtimeStoreKitCatalogStateBrand: unique symbol = Symbol("RuntimeStoreKitCatalogState");
const runtimeStoreKitCatalogStates = new WeakSet<object>();
const catalogProductShapeSchema = z.strictObject({
  productId: z.unknown(),
  productType: z.unknown(),
});
const catalogInputSchema = z.array(catalogProductShapeSchema).min(1).max(32);

interface StoreKitCatalogEntitlementStateFields {
  readonly catalogId: StoreKitCatalogId;
  readonly currentFacts: readonly VerifiedStoreKitEntitlementFact[];
  readonly latestSnapshot: StoreKitSnapshotPosition | null;
  readonly latestUnavailable: StoreKitUnavailableEvent | null;
  readonly processedEvents: readonly ProcessedStoreKitEvent[];
  readonly snapshotFacts: readonly VerifiedStoreKitEntitlementFact[];
  readonly transactionFacts: readonly VerifiedStoreKitEntitlementFact[];
}

export interface StoreKitCatalogEntitlementState extends StoreKitCatalogEntitlementStateFields {
  readonly [runtimeStoreKitCatalogStateBrand]: true;
}

function catalogIdentity(products: readonly StoreKitProductPolicy[]): StoreKitCatalogId {
  return `storekit-catalog-v1|${products
    .map((product) =>
      JSON.stringify([product.productId.length, product.productId, product.productType]),
    )
    .join("|")}` as StoreKitCatalogId;
}

export function createStoreKitEntitlementCatalog(
  input: unknown,
): Result<StoreKitEntitlementCatalog, LenaError> {
  const parsedInput = catalogInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return err(
      new LenaError("limit_exceeded", "StoreKit entitlement catalog size is invalid", {
        boundary: "storekit_catalog",
      }),
    );
  }

  const products: StoreKitProductPolicy[] = [];
  const productIds = new Set<StoreKitProductId>();
  for (const inputProduct of parsedInput.data) {
    const product = createStoreKitProductPolicy(inputProduct.productId, inputProduct.productType);
    if (product.isErr()) {
      return err(product.error);
    }
    if (productIds.has(product.value.productId)) {
      return err(
        new LenaError("conflict", "StoreKit product appears more than once", {
          boundary: "storekit_catalog",
        }),
      );
    }
    productIds.add(product.value.productId);
    products.push(product.value);
  }

  const canonicalProducts = orderBy(
    products,
    [(product) => product.productId, (product) => product.productType],
    ["asc", "asc"],
  );
  return ok(
    Object.freeze({
      id: catalogIdentity(canonicalProducts),
      products: Object.freeze(canonicalProducts),
    }),
  );
}

export function findStoreKitCatalogProduct(
  catalog: StoreKitEntitlementCatalog,
  productId: StoreKitProductId,
): StoreKitProductPolicy | null {
  return catalog.products.find((product) => product.productId === productId) ?? null;
}

export function createInitialStoreKitCatalogEntitlementState(
  catalog: StoreKitEntitlementCatalog,
): StoreKitCatalogEntitlementState {
  return freezeState({
    catalogId: catalog.id,
    currentFacts: [],
    latestSnapshot: null,
    latestUnavailable: null,
    processedEvents: [],
    snapshotFacts: [],
    transactionFacts: [],
  });
}

function catalogMismatchError(): LenaError {
  return new LenaError("conflict", "StoreKit entitlement state belongs to another catalog", {
    boundary: "storekit_catalog",
    reason: "catalog_changed",
  });
}

function validateCatalogFacts(
  facts: readonly VerifiedStoreKitEntitlementFact[],
  catalog: StoreKitEntitlementCatalog,
): Result<readonly VerifiedStoreKitEntitlementFact[], LenaError> {
  for (const fact of facts) {
    if (!isVerifiedStoreKitEntitlementFact(fact)) {
      return err(
        new LenaError("authentication_required", "StoreKit fact lacks native verification", {
          boundary: "storekit_catalog",
        }),
      );
    }
    const product = findStoreKitCatalogProduct(catalog, fact.productId);
    if (product === null) {
      return err(
        new LenaError("invalid_input", "StoreKit event contains an unconfigured product", {
          boundary: "storekit_catalog",
        }),
      );
    }
    if (
      (product.productType === "non-consumable" &&
        (fact.expiresAt !== null || fact.disposition === "expired")) ||
      (product.productType === "auto-renewable-subscription" && fact.expiresAt === null)
    ) {
      return err(
        new LenaError("invalid_input", "StoreKit fact conflicts with catalog product type", {
          boundary: "storekit_catalog",
        }),
      );
    }
  }
  return ok(facts);
}

function currentFactPerProduct(
  facts: readonly VerifiedStoreKitEntitlementFact[],
): readonly VerifiedStoreKitEntitlementFact[] {
  const byProduct = groupBy(facts, (fact) => fact.productId);

  return Object.freeze(
    orderBy(Object.entries(byProduct), [([productId]) => productId], ["asc"])
      .map(([, factsForProduct]) => selectLatestStoreKitFact(factsForProduct))
      .filter((fact): fact is VerifiedStoreKitEntitlementFact => fact !== null),
  );
}

function sortedProcessedEvents(
  events: readonly ProcessedStoreKitEvent[],
): readonly ProcessedStoreKitEvent[] {
  return Object.freeze(orderBy(events, [(event) => event.sequence], ["asc"]));
}

function processedEventResult(
  state: StoreKitCatalogEntitlementState,
  sequence: StoreKitSequence,
  fingerprint: string,
): Result<"duplicate" | "new", LenaError> {
  const existing = state.processedEvents.find((event) => event.sequence === sequence);
  if (existing === undefined) {
    return ok("new");
  }
  if (existing.fingerprint === fingerprint) {
    return ok("duplicate");
  }
  return err(
    new LenaError("conflict", "StoreKit sequence was reused for another event", {
      boundary: "storekit_catalog",
      reason: "sequence_collision",
    }),
  );
}

function isRuntimeStoreKitCatalogEntitlementState(
  input: unknown,
): input is StoreKitCatalogEntitlementState {
  return (
    typeof input === "object" &&
    input !== null &&
    runtimeStoreKitCatalogStates.has(input) &&
    (input as { readonly [runtimeStoreKitCatalogStateBrand]?: unknown })[
      runtimeStoreKitCatalogStateBrand
    ] === true
  );
}

function freezeState(
  state: StoreKitCatalogEntitlementStateFields,
): StoreKitCatalogEntitlementState {
  const runtimeState = {
    catalogId: state.catalogId,
    currentFacts: Object.freeze([...state.currentFacts]),
    latestSnapshot:
      state.latestSnapshot === null ? null : Object.freeze({ ...state.latestSnapshot }),
    latestUnavailable: state.latestUnavailable,
    processedEvents: Object.freeze(
      state.processedEvents.map((event) => Object.freeze({ ...event })),
    ),
    snapshotFacts: Object.freeze([...state.snapshotFacts]),
    transactionFacts: Object.freeze([...state.transactionFacts]),
  } as Record<PropertyKey, unknown>;
  Object.defineProperty(runtimeState, runtimeStoreKitCatalogStateBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  const issuedState = Object.freeze(runtimeState) as unknown as StoreKitCatalogEntitlementState;
  runtimeStoreKitCatalogStates.add(issuedState);
  return issuedState;
}

function runtimeStateError(): LenaError {
  return new LenaError("authentication_required", "StoreKit state lacks reducer authority", {
    boundary: "storekit_catalog",
  });
}

export function reduceStoreKitCatalogEntitlement(
  state: StoreKitCatalogEntitlementState,
  inputEvent: StoreKitEntitlementEvent,
  catalog: StoreKitEntitlementCatalog,
): Result<StoreKitCatalogEntitlementState, LenaError> {
  if (!isRuntimeStoreKitCatalogEntitlementState(state)) {
    return err(runtimeStateError());
  }
  if (state.catalogId !== catalog.id) {
    return err(catalogMismatchError());
  }

  const parsedEvent = parseStoreKitEntitlementEvent(inputEvent);
  if (parsedEvent.isErr()) {
    return err(parsedEvent.error);
  }
  const authorizedEvent = parsedEvent.value;
  const eventFacts = match(authorizedEvent)
    .with({ type: "transaction" }, ({ fact }) => [fact])
    .with({ type: "snapshot" }, ({ facts }) => facts)
    .with({ type: "unavailable" }, () => [])
    .exhaustive();
  const validFacts = validateCatalogFacts(eventFacts, catalog);
  if (validFacts.isErr()) {
    return err(validFacts.error);
  }

  const sequence = storeKitEntitlementEventSequence(authorizedEvent);
  const fingerprint = storeKitEntitlementEventFingerprint(authorizedEvent);
  const processed = processedEventResult(state, sequence, fingerprint);
  if (processed.isErr()) {
    return err(processed.error);
  }
  if (processed.value === "duplicate") {
    return ok(state);
  }

  return match(authorizedEvent)
    .with({ type: "snapshot" }, (event) => {
      if (state.latestSnapshot !== null && event.sequence < state.latestSnapshot.sequence) {
        return ok(state);
      }

      const transactionFacts = state.transactionFacts.filter(
        (fact) => fact.sequence > event.sequence,
      );
      const currentFacts = currentFactPerProduct([...event.facts, ...transactionFacts]);
      const processedEvents = sortedProcessedEvents([
        ...state.processedEvents.filter(
          (processedEvent) => processedEvent.sequence > event.sequence,
        ),
        Object.freeze({ fingerprint, sequence }),
      ]);
      return ok(
        freezeState({
          catalogId: state.catalogId,
          currentFacts,
          latestSnapshot: Object.freeze({
            observedAt: event.observedAt,
            sequence: event.sequence,
          }),
          latestUnavailable:
            state.latestUnavailable !== null && state.latestUnavailable.sequence > event.sequence
              ? state.latestUnavailable
              : null,
          processedEvents,
          snapshotFacts: event.facts,
          transactionFacts,
        }),
      );
    })
    .with({ type: "transaction" }, (event) => {
      if (state.latestSnapshot !== null && sequence <= state.latestSnapshot.sequence) {
        return ok(state);
      }
      const transactionFacts = orderBy(
        [...state.transactionFacts, event.fact],
        [(fact) => fact.sequence],
        ["asc"],
      );
      return ok(
        freezeState({
          ...state,
          currentFacts: currentFactPerProduct([...state.snapshotFacts, ...transactionFacts]),
          processedEvents: sortedProcessedEvents([
            ...state.processedEvents,
            Object.freeze({ fingerprint, sequence }),
          ]),
          transactionFacts,
        }),
      );
    })
    .with({ type: "unavailable" }, (event) => {
      if (state.latestSnapshot !== null && sequence <= state.latestSnapshot.sequence) {
        return ok(state);
      }
      const latestUnavailable =
        state.latestUnavailable === null || event.sequence > state.latestUnavailable.sequence
          ? event
          : state.latestUnavailable;
      return ok(
        freezeState({
          ...state,
          latestUnavailable,
          processedEvents: sortedProcessedEvents([
            ...state.processedEvents,
            Object.freeze({ fingerprint, sequence }),
          ]),
        }),
      );
    })
    .exhaustive();
}

export function reduceStoreKitCatalogEntitlementEvents(
  initialState: StoreKitCatalogEntitlementState,
  events: readonly StoreKitEntitlementEvent[],
  catalog: StoreKitEntitlementCatalog,
): Result<StoreKitCatalogEntitlementState, LenaError> {
  if (!isRuntimeStoreKitCatalogEntitlementState(initialState)) {
    return err(runtimeStateError());
  }
  if (initialState.catalogId !== catalog.id) {
    return err(catalogMismatchError());
  }

  const parsedEvents: StoreKitEntitlementEvent[] = [];
  for (const event of events) {
    const parsed = parseStoreKitEntitlementEvent(event);
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    parsedEvents.push(parsed.value);
  }
  const orderedEvents = orderBy(
    parsedEvents,
    [(event) => storeKitEntitlementEventSequence(event)],
    ["asc"],
  );

  let state = initialState;
  for (const event of orderedEvents) {
    const reduced = reduceStoreKitCatalogEntitlement(state, event, catalog);
    if (reduced.isErr()) {
      return err(reduced.error);
    }
    state = reduced.value;
  }
  return ok(state);
}

function latestStateObservation(state: StoreKitCatalogEntitlementState): IsoTimestamp | null {
  const observations = [
    ...state.currentFacts.map((fact) => fact.observedAt),
    ...(state.latestSnapshot === null ? [] : [state.latestSnapshot.observedAt]),
    ...(state.latestUnavailable === null ? [] : [state.latestUnavailable.observedAt]),
  ];
  return maxBy(observations, (timestamp) => parseISO(timestamp).getTime()) ?? null;
}

function factVerifiedAt(
  state: StoreKitCatalogEntitlementState,
  fact: VerifiedStoreKitEntitlementFact,
): IsoTimestamp {
  const isPostSnapshotTransaction = state.transactionFacts.some(
    (transactionFact) => transactionFact.sequence === fact.sequence,
  );
  return isPostSnapshotTransaction || state.latestSnapshot === null
    ? fact.observedAt
    : state.latestSnapshot.observedAt;
}

function factGrantsAccessAt(
  fact: VerifiedStoreKitEntitlementFact,
  product: StoreKitProductPolicy,
  asOf: IsoTimestamp,
): boolean {
  if (fact.disposition !== "active" || isBefore(parseISO(asOf), parseISO(fact.effectiveAt))) {
    return false;
  }
  return (
    product.productType === "non-consumable" ||
    (fact.expiresAt !== null && isBefore(parseISO(asOf), parseISO(fact.expiresAt)))
  );
}

export function evaluateStoreKitCatalogEntitlement(
  state: StoreKitCatalogEntitlementState,
  catalog: StoreKitEntitlementCatalog,
  asOfInput: unknown,
): Result<StoreKitEntitlementAuthority, LenaError> {
  if (!isRuntimeStoreKitCatalogEntitlementState(state)) {
    return err(runtimeStateError());
  }
  if (state.catalogId !== catalog.id) {
    return err(catalogMismatchError());
  }
  const asOf = parseIsoTimestamp(asOfInput);
  if (asOf.isErr()) {
    return err(asOf.error);
  }
  const latestObservation = latestStateObservation(state);
  if (latestObservation !== null && compareIsoTimestamps(asOf.value, latestObservation) < 0) {
    return err(
      new LenaError("invalid_input", "Entitlement evaluation predates observed StoreKit state", {
        boundary: "storekit_catalog",
      }),
    );
  }
  const validFacts = validateCatalogFacts(state.currentFacts, catalog);
  if (validFacts.isErr()) {
    return err(validFacts.error);
  }

  const active = state.currentFacts
    .filter((fact) => {
      const product = findStoreKitCatalogProduct(catalog, fact.productId);
      return product !== null && factGrantsAccessAt(fact, product, asOf.value);
    })
    .toSorted((left, right) => {
      const leftProduct = findStoreKitCatalogProduct(catalog, left.productId);
      const rightProduct = findStoreKitCatalogProduct(catalog, right.productId);
      const leftPriority = leftProduct?.productType === "non-consumable" ? 1 : 0;
      const rightPriority = rightProduct?.productType === "non-consumable" ? 1 : 0;
      return rightPriority - leftPriority || right.sequence - left.sequence;
    });
  const entitled = active[0];
  if (entitled !== undefined) {
    const product = findStoreKitCatalogProduct(catalog, entitled.productId);
    if (product === null) {
      return err(catalogMismatchError());
    }
    return ok(
      Object.freeze({
        evaluatedAt: asOf.value,
        expiresAt: entitled.expiresAt,
        kind: "entitled" as const,
        productId: entitled.productId,
        productType: product.productType,
        verifiedAt: factVerifiedAt(state, entitled),
      }),
    );
  }

  const terminal = maxBy(state.currentFacts, (fact) => fact.sequence);
  if (terminal !== undefined) {
    const product = findStoreKitCatalogProduct(catalog, terminal.productId);
    if (product === null) {
      return err(catalogMismatchError());
    }
    const reason =
      terminal.disposition === "active" && product.productType === "auto-renewable-subscription"
        ? "expired"
        : terminal.disposition === "active"
          ? "no_current_entitlement"
          : terminal.disposition;
    return ok(
      Object.freeze({
        evaluatedAt: asOf.value,
        kind: "not_entitled" as const,
        reason,
        verifiedAt: factVerifiedAt(state, terminal),
      }),
    );
  }

  if (state.latestSnapshot !== null) {
    return ok(
      Object.freeze({
        evaluatedAt: asOf.value,
        kind: "not_entitled" as const,
        reason: "no_current_entitlement" as const,
        verifiedAt: state.latestSnapshot.observedAt,
      }),
    );
  }
  if (state.latestUnavailable !== null) {
    return ok(
      Object.freeze({
        kind: "unavailable" as const,
        observedAt: state.latestUnavailable.observedAt,
        reason: state.latestUnavailable.reason,
      }),
    );
  }
  return ok(Object.freeze({ kind: "unknown" as const }));
}

export function hasStoreKitCatalogPaidAccess(
  state: StoreKitCatalogEntitlementState,
  catalog: StoreKitEntitlementCatalog,
  asOf: unknown,
): Result<boolean, LenaError> {
  const authority = evaluateStoreKitCatalogEntitlement(state, catalog, asOf);
  return authority.isOk() ? ok(authority.value.kind === "entitled") : err(authority.error);
}
