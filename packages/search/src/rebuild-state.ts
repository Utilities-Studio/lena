import { err, LenaError, ok, type LenaErrorCode, type Result } from "@lena/core";
import { match } from "ts-pattern";
import { z } from "zod";
import type { SearchIndexIdentity } from "./index-identity";

export interface SearchIndexCheckpoint {
  readonly cursor: string | null;
  readonly removedDocuments: number;
  readonly upsertedDocuments: number;
}

export interface AbsentSearchIndexState {
  readonly status: "absent";
}

export interface ReadySearchIndexState {
  readonly documentCount: number;
  readonly identity: SearchIndexIdentity;
  readonly sourceRevision: string;
  readonly status: "ready";
}

export interface RebuildingSearchIndexState {
  readonly checkpoint: SearchIndexCheckpoint;
  readonly previousReady: ReadySearchIndexState | null;
  readonly rebuildId: string;
  readonly sourceRevision: string;
  readonly status: "rebuilding";
  readonly targetIdentity: SearchIndexIdentity;
}

export interface FailedSearchIndexState {
  readonly checkpoint: SearchIndexCheckpoint;
  readonly errorCode: LenaErrorCode;
  readonly previousReady: ReadySearchIndexState | null;
  readonly rebuildId: string;
  readonly sourceRevision: string;
  readonly status: "failed";
  readonly targetIdentity: SearchIndexIdentity;
}

export type SearchIndexRebuildState =
  | AbsentSearchIndexState
  | ReadySearchIndexState
  | RebuildingSearchIndexState
  | FailedSearchIndexState;

export type SearchIndexRebuildEvent =
  | Readonly<{
      rebuildId: string;
      sourceRevision: string;
      targetIdentity: SearchIndexIdentity;
      type: "rebuild_requested";
    }>
  | Readonly<{
      nextCursor: string;
      rebuildId: string;
      removedDocuments: number;
      type: "batch_committed";
      upsertedDocuments: number;
    }>
  | Readonly<{ documentCount: number; rebuildId: string; type: "rebuild_completed" }>
  | Readonly<{ errorCode: LenaErrorCode; rebuildId: string; type: "rebuild_failed" }>
  | Readonly<{ rebuildId: string; type: "resume_requested" }>
  | Readonly<{ rebuildId: string; type: "discard_requested" }>;

export interface SearchDeletionPlan {
  readonly documentId: string;
  readonly operations: readonly ["delete_lexical", "delete_vector"];
  readonly sourceRevision: string;
}

export const ABSENT_SEARCH_INDEX: AbsentSearchIndexState = Object.freeze({
  status: "absent",
});

export function transitionSearchIndexRebuild(
  state: SearchIndexRebuildState,
  inputEvent: SearchIndexRebuildEvent,
): Result<SearchIndexRebuildState, LenaError> {
  return match(inputEvent)
    .with({ type: "rebuild_requested" }, (event) => {
      const rebuildId = parseOpaqueValue(event.rebuildId, "Rebuild id", 256);
      if (rebuildId.isErr()) return err(rebuildId.error);
      const sourceRevision = parseOpaqueValue(event.sourceRevision, "Source revision", 256);
      if (sourceRevision.isErr()) return err(sourceRevision.error);
      return ok(
        Object.freeze({
          checkpoint: emptyCheckpoint(),
          previousReady: findPreviousReady(state),
          rebuildId: rebuildId.value,
          sourceRevision: sourceRevision.value,
          status: "rebuilding" as const,
          targetIdentity: event.targetIdentity,
        }),
      );
    })
    .with({ type: "batch_committed" }, (event) => {
      if (state.status !== "rebuilding") return invalidTransition(state, event.type);
      const matching = requireActiveRebuild(state.rebuildId, event.rebuildId);
      if (matching.isErr()) return err(matching.error);
      const cursor = parseOpaqueValue(event.nextCursor, "Rebuild cursor", 1_024);
      if (cursor.isErr()) return err(cursor.error);
      if (
        !isNonNegativeInteger(event.upsertedDocuments) ||
        !isNonNegativeInteger(event.removedDocuments)
      ) {
        return err(new LenaError("invalid_input"));
      }
      if (event.upsertedDocuments === 0 && event.removedDocuments === 0) {
        return err(new LenaError("invalid_input"));
      }
      const upsertedDocuments = state.checkpoint.upsertedDocuments + event.upsertedDocuments;
      const removedDocuments = state.checkpoint.removedDocuments + event.removedDocuments;
      if (!Number.isSafeInteger(upsertedDocuments) || !Number.isSafeInteger(removedDocuments)) {
        return err(new LenaError("limit_exceeded"));
      }
      return ok(
        Object.freeze({
          ...state,
          checkpoint: Object.freeze({
            cursor: cursor.value,
            removedDocuments,
            upsertedDocuments,
          }),
        }),
      );
    })
    .with({ type: "rebuild_completed" }, (event) => {
      if (state.status !== "rebuilding") return invalidTransition(state, event.type);
      const matching = requireActiveRebuild(state.rebuildId, event.rebuildId);
      if (matching.isErr()) return err(matching.error);
      if (!isNonNegativeInteger(event.documentCount)) {
        return err(new LenaError("invalid_input"));
      }
      return ok(
        Object.freeze({
          documentCount: event.documentCount,
          identity: state.targetIdentity,
          sourceRevision: state.sourceRevision,
          status: "ready" as const,
        }),
      );
    })
    .with({ type: "rebuild_failed" }, (event) => {
      if (state.status !== "rebuilding") return invalidTransition(state, event.type);
      const matching = requireActiveRebuild(state.rebuildId, event.rebuildId);
      if (matching.isErr()) return err(matching.error);
      return ok(
        Object.freeze({
          checkpoint: state.checkpoint,
          errorCode: event.errorCode,
          previousReady: state.previousReady,
          rebuildId: state.rebuildId,
          sourceRevision: state.sourceRevision,
          status: "failed" as const,
          targetIdentity: state.targetIdentity,
        }),
      );
    })
    .with({ type: "resume_requested" }, (event) => {
      if (state.status !== "failed") return invalidTransition(state, event.type);
      const matching = requireActiveRebuild(state.rebuildId, event.rebuildId);
      if (matching.isErr()) return err(matching.error);
      return ok(
        Object.freeze({
          checkpoint: state.checkpoint,
          previousReady: state.previousReady,
          rebuildId: state.rebuildId,
          sourceRevision: state.sourceRevision,
          status: "rebuilding" as const,
          targetIdentity: state.targetIdentity,
        }),
      );
    })
    .with({ type: "discard_requested" }, (event) => {
      if (state.status !== "failed" && state.status !== "rebuilding") {
        return invalidTransition(state, event.type);
      }
      const matching = requireActiveRebuild(state.rebuildId, event.rebuildId);
      if (matching.isErr()) return err(matching.error);
      return ok(state.previousReady ?? ABSENT_SEARCH_INDEX);
    })
    .exhaustive();
}

function requireActiveRebuild(
  activeRebuildId: string,
  eventRebuildIdValue: unknown,
): Result<true, LenaError> {
  const eventRebuildId = parseOpaqueValue(eventRebuildIdValue, "Rebuild id", 256);
  if (eventRebuildId.isErr()) return err(eventRebuildId.error);
  return eventRebuildId.value === activeRebuildId
    ? ok(true)
    : err(
        new LenaError("conflict", {
          boundary: "search_rebuild",
        }),
      );
}

export function createSearchDeletionPlan(
  documentIdValue: unknown,
  sourceRevisionValue: unknown,
): Result<SearchDeletionPlan, LenaError> {
  const documentId = parseOpaqueValue(documentIdValue, "Document id", 512);
  if (documentId.isErr()) return err(documentId.error);
  const sourceRevision = parseOpaqueValue(sourceRevisionValue, "Source revision", 256);
  if (sourceRevision.isErr()) return err(sourceRevision.error);

  return ok(
    Object.freeze({
      documentId: documentId.value,
      operations: Object.freeze(["delete_lexical", "delete_vector"] as const),
      sourceRevision: sourceRevision.value,
    }),
  );
}

function emptyCheckpoint(): SearchIndexCheckpoint {
  return Object.freeze({
    cursor: null,
    removedDocuments: 0,
    upsertedDocuments: 0,
  });
}

function findPreviousReady(state: SearchIndexRebuildState): ReadySearchIndexState | null {
  if (state.status === "ready") return state;
  if (state.status === "rebuilding" || state.status === "failed") {
    return state.previousReady;
  }
  return null;
}

function invalidTransition(
  state: SearchIndexRebuildState,
  event: SearchIndexRebuildEvent["type"],
): Result<never, LenaError> {
  return err(
    new LenaError("invalid_state_transition", {
      event,
      state: state.status,
    }),
  );
}

function parseOpaqueValue(
  value: unknown,
  name: string,
  maximumLength: number,
): Result<string, LenaError> {
  const parsed = z.string().safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_input"));
  }
  const normalized = parsed.data.normalize("NFC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximumLength ||
    hasControlCharacter(normalized)
  ) {
    return err(new LenaError("invalid_input"));
  }
  return ok(normalized);
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
      return true;
    }
  }
  return false;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
