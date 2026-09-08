import {
  compareIsoTimestamps,
  err,
  isoTimestampSchema,
  LenaError,
  ok,
  parseIsoTimestamp,
  type IsoTimestamp,
  type Result,
} from "@lena/core";

import {
  parseSyncConsentId,
  parseSyncConsentRequestId,
  syncConsentIdSchema,
  syncConsentRequestIdSchema,
  type SyncConsentId,
  type SyncConsentRequestId,
} from "./identifiers";
import { match } from "ts-pattern";
import { z } from "zod";

export interface HostedSyncConsentRequest {
  readonly disclosureVersion: string;
  readonly requestId: SyncConsentRequestId;
  readonly requestedAt: IsoTimestamp;
}

export interface HostedSyncConsentGrant {
  readonly consentId: SyncConsentId;
  readonly disclosureVersion: string;
  readonly grantedAt: IsoTimestamp;
  readonly requestId: SyncConsentRequestId;
}

export type SyncConsentState =
  | Readonly<{
      latestRequest: null;
      mode: "private_vault";
      status: "not_requested";
    }>
  | Readonly<{
      latestRequest: HostedSyncConsentRequest;
      mode: "private_vault";
      request: HostedSyncConsentRequest;
      status: "awaiting_explicit_consent";
    }>
  | Readonly<{
      consent: HostedSyncConsentGrant;
      latestRequest: HostedSyncConsentRequest;
      mode: "hosted_sync";
      status: "granted";
    }>
  | Readonly<{
      decidedAt: IsoTimestamp;
      latestRequest: HostedSyncConsentRequest;
      mode: "private_vault";
      requestId: SyncConsentRequestId;
      status: "declined";
    }>
  | Readonly<{
      consentId: SyncConsentId;
      latestRequest: HostedSyncConsentRequest;
      mode: "private_vault";
      status: "withdrawn";
      withdrawnAt: IsoTimestamp;
    }>;

const DISCLOSURE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const disclosureVersionSchema = z.string().regex(DISCLOSURE_VERSION_PATTERN);

const hostedSyncConsentRequestSchema = z.strictObject({
  disclosureVersion: disclosureVersionSchema,
  requestId: syncConsentRequestIdSchema,
  requestedAt: isoTimestampSchema,
});

const hostedSyncConsentGrantSchema = z.strictObject({
  consentId: syncConsentIdSchema,
  disclosureVersion: disclosureVersionSchema,
  grantedAt: isoTimestampSchema,
  requestId: syncConsentRequestIdSchema,
});

const unrelatedSyncAuthoritySourceSchema = z.enum([
  "app_update",
  "backup_authorization",
  "backup_provider",
  "login",
  "purchase",
  "sign_out",
]);

const syncConsentEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ request: hostedSyncConsentRequestSchema, type: z.literal("request") }),
  z.strictObject({
    confirmation: z.literal("explicit"),
    grant: hostedSyncConsentGrantSchema,
    type: z.literal("grant"),
  }),
  z.strictObject({
    decidedAt: isoTimestampSchema,
    requestId: syncConsentRequestIdSchema,
    type: z.literal("decline"),
  }),
  z.strictObject({
    consentId: syncConsentIdSchema,
    type: z.literal("withdraw"),
    withdrawnAt: isoTimestampSchema,
  }),
  z.strictObject({
    occurredAt: isoTimestampSchema,
    source: unrelatedSyncAuthoritySourceSchema,
    type: z.literal("unrelated_authority_changed"),
  }),
]);

export type UnrelatedSyncAuthoritySource = z.infer<typeof unrelatedSyncAuthoritySourceSchema>;
export type SyncConsentEvent = Readonly<z.infer<typeof syncConsentEventSchema>>;

function parseDisclosureVersion(value: unknown): Result<string, LenaError> {
  const parsed = disclosureVersionSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      new LenaError("invalid_input", {
        boundary: "sync_consent",
      }),
    );
  }

  return ok(parsed.data);
}

export const INITIAL_SYNC_CONSENT_STATE: SyncConsentState = Object.freeze({
  latestRequest: null,
  mode: "private_vault" as const,
  status: "not_requested" as const,
});

export function createHostedSyncConsentRequest(
  input: Readonly<{
    disclosureVersion: unknown;
    requestId: unknown;
    requestedAt: unknown;
  }>,
): Result<HostedSyncConsentRequest, LenaError> {
  const disclosureVersion = parseDisclosureVersion(input.disclosureVersion);
  const requestId = parseSyncConsentRequestId(input.requestId);
  const requestedAt = parseIsoTimestamp(input.requestedAt);
  if (disclosureVersion.isErr()) return err(disclosureVersion.error);
  if (requestId.isErr()) return err(requestId.error);
  if (requestedAt.isErr()) return err(requestedAt.error);

  return ok(
    Object.freeze({
      disclosureVersion: disclosureVersion.value,
      requestId: requestId.value,
      requestedAt: requestedAt.value,
    }),
  );
}

export function createExplicitHostedSyncConsentGrant(
  input: Readonly<{
    confirmation: unknown;
    consentId: unknown;
    disclosureVersion: unknown;
    grantedAt: unknown;
    requestId: unknown;
  }>,
): Result<Extract<SyncConsentEvent, { type: "grant" }>, LenaError> {
  if (input.confirmation !== "explicit") {
    return err(
      new LenaError("invalid_input", {
        boundary: "sync_consent",
      }),
    );
  }

  const consentId = parseSyncConsentId(input.consentId);
  const requestId = parseSyncConsentRequestId(input.requestId);
  const disclosureVersion = parseDisclosureVersion(input.disclosureVersion);
  const grantedAt = parseIsoTimestamp(input.grantedAt);
  if (consentId.isErr()) return err(consentId.error);
  if (requestId.isErr()) return err(requestId.error);
  if (disclosureVersion.isErr()) return err(disclosureVersion.error);
  if (grantedAt.isErr()) return err(grantedAt.error);

  return ok(
    Object.freeze({
      confirmation: "explicit" as const,
      grant: Object.freeze({
        consentId: consentId.value,
        disclosureVersion: disclosureVersion.value,
        grantedAt: grantedAt.value,
        requestId: requestId.value,
      }),
      type: "grant" as const,
    }),
  );
}

export function reduceSyncConsent(
  state: SyncConsentState,
  inputEvent: SyncConsentEvent,
): Result<SyncConsentState, LenaError> {
  const parsedEvent = syncConsentEventSchema.safeParse(inputEvent);
  if (!parsedEvent.success) {
    return err(
      new LenaError("invalid_input", {
        boundary: "sync_consent",
      }),
    );
  }

  return match(parsedEvent.data)
    .with({ type: "unrelated_authority_changed" }, () => ok(state))
    .with({ type: "request" }, (event) => {
      const parsedRequest = createHostedSyncConsentRequest(event.request);
      if (parsedRequest.isErr()) return err(parsedRequest.error);
      const request = parsedRequest.value;
      if (state.latestRequest !== null && state.latestRequest.requestId === request.requestId) {
        return state.latestRequest.disclosureVersion === request.disclosureVersion &&
          state.latestRequest.requestedAt === request.requestedAt
          ? ok(state)
          : err(
              new LenaError("conflict", {
                boundary: "sync_consent",
              }),
            );
      }
      if (state.status === "granted") {
        return err(
          new LenaError("invalid_state_transition", {
            boundary: "sync_consent",
          }),
        );
      }
      if (
        state.latestRequest !== null &&
        compareIsoTimestamps(request.requestedAt, state.latestRequest.requestedAt) <= 0
      ) {
        return err(
          new LenaError("conflict", {
            boundary: "sync_consent",
          }),
        );
      }

      return ok(
        Object.freeze({
          latestRequest: request,
          mode: "private_vault" as const,
          request,
          status: "awaiting_explicit_consent" as const,
        }),
      );
    })

    .with({ type: "grant" }, (event) => {
      if (
        state.status !== "awaiting_explicit_consent" ||
        state.request.requestId !== event.grant.requestId ||
        state.request.disclosureVersion !== event.grant.disclosureVersion ||
        compareIsoTimestamps(event.grant.grantedAt, state.request.requestedAt) < 0
      ) {
        return err(new LenaError("invalid_state_transition", { boundary: "sync_consent" }));
      }

      return ok(
        Object.freeze({
          consent: event.grant,
          latestRequest: state.request,
          mode: "hosted_sync" as const,
          status: "granted" as const,
        }),
      );
    })

    .with({ type: "decline" }, (event) => {
      if (
        state.status !== "awaiting_explicit_consent" ||
        state.request.requestId !== event.requestId ||
        compareIsoTimestamps(event.decidedAt, state.request.requestedAt) < 0
      ) {
        return err(
          new LenaError("invalid_state_transition", {
            boundary: "sync_consent",
          }),
        );
      }

      return ok(
        Object.freeze({
          decidedAt: event.decidedAt,
          latestRequest: state.request,
          mode: "private_vault" as const,
          requestId: event.requestId,
          status: "declined" as const,
        }),
      );
    })

    .with({ type: "withdraw" }, (event) => {
      if (state.status !== "granted" || state.consent.consentId !== event.consentId) {
        return err(
          new LenaError("invalid_state_transition", {
            boundary: "sync_consent",
          }),
        );
      }
      if (compareIsoTimestamps(event.withdrawnAt, state.consent.grantedAt) < 0) {
        return err(
          new LenaError("invalid_state_transition", {
            boundary: "sync_consent",
          }),
        );
      }

      return ok(
        Object.freeze({
          consentId: event.consentId,
          latestRequest: state.latestRequest,
          mode: "private_vault" as const,
          status: "withdrawn" as const,
          withdrawnAt: event.withdrawnAt,
        }),
      );
    })
    .exhaustive();
}
