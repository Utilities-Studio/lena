import { err, LenaError, ok, type Result } from "@lena/core";
import { uniq } from "es-toolkit";
import { z } from "zod";

export const MAX_FTS_CLAUSES = 64;
export const MAX_FTS_CLAUSE_CODE_POINTS = 2_048;

export const ftsClauseKindSchema = z.enum(["phrase", "prefix", "term"]);
export const ftsQueryModeSchema = z.enum(["all", "any"]);
export const ftsQueryClauseSchema = z.strictObject({
  columns: z.array(z.string()).optional(),
  kind: ftsClauseKindSchema,
  text: z.string(),
});
export const ftsQueryInputSchema = z.strictObject({
  clauses: z.array(ftsQueryClauseSchema).min(1),
  mode: ftsQueryModeSchema,
});

export type FtsClauseKind = z.infer<typeof ftsClauseKindSchema>;
export type FtsQueryMode = z.infer<typeof ftsQueryModeSchema>;
export type FtsQueryClause = Readonly<z.infer<typeof ftsQueryClauseSchema>>;
export type FtsQueryInput = Readonly<z.infer<typeof ftsQueryInputSchema>>;

export interface CompiledFtsQuery {
  readonly clauseCount: number;
  /** Bind this value as the FTS5 MATCH parameter. Never interpolate it into SQL. */
  readonly matchParameter: string;
}

const COLUMN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function buildFts5Query(input: FtsQueryInput): Result<CompiledFtsQuery, LenaError> {
  const parsedInput = ftsQueryInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return err(new LenaError("invalid_input", "FTS query requires at least one clause"));
  }

  if (parsedInput.data.clauses.length > MAX_FTS_CLAUSES) {
    return err(
      new LenaError("limit_exceeded", "FTS query has too many clauses", {
        maximum: MAX_FTS_CLAUSES,
      }),
    );
  }

  const compiledClauses: string[] = [];
  for (const clause of parsedInput.data.clauses) {
    const compiled = compileClause(clause);
    if (compiled.isErr()) {
      return err(compiled.error);
    }
    compiledClauses.push(`(${compiled.value})`);
  }

  return ok(
    Object.freeze({
      clauseCount: compiledClauses.length,
      matchParameter: compiledClauses.join(parsedInput.data.mode === "all" ? " AND " : " OR "),
    }),
  );
}

function compileClause(clause: FtsQueryClause): Result<string, LenaError> {
  if (clause.kind !== "term" && clause.kind !== "phrase" && clause.kind !== "prefix") {
    return err(new LenaError("invalid_input", "Invalid FTS clause kind"));
  }

  const normalizedText = normalizeClauseText(clause.text);
  if (normalizedText.isErr()) {
    return err(normalizedText.error);
  }

  if (clause.kind !== "phrase" && /\s/u.test(normalizedText.value)) {
    return err(new LenaError("invalid_input", "FTS term and prefix clauses must contain one term"));
  }

  const quotedText = `"${normalizedText.value.replaceAll('"', '""')}"`;
  const literal = clause.kind === "prefix" ? `${quotedText} *` : quotedText;
  const columns = normalizeColumns(clause.columns);
  if (columns.isErr()) {
    return err(columns.error);
  }

  if (columns.value.length === 0) {
    return ok(literal);
  }

  return ok(`{${columns.value.join(" ")}} : ${literal}`);
}

function normalizeClauseText(value: unknown): Result<string, LenaError> {
  if (typeof value !== "string") {
    return err(new LenaError("invalid_input", "FTS clause text must be a string"));
  }

  if (hasForbiddenFtsControlCharacter(value)) {
    return err(new LenaError("invalid_input", "FTS clause text contains a control character"));
  }

  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) {
    return err(new LenaError("invalid_input", "FTS clause text is empty"));
  }

  if (Array.from(normalized).length > MAX_FTS_CLAUSE_CODE_POINTS) {
    return err(
      new LenaError("limit_exceeded", "FTS clause text is too long", {
        maximum: MAX_FTS_CLAUSE_CODE_POINTS,
      }),
    );
  }

  return ok(normalized);
}

function normalizeColumns(
  value: readonly string[] | undefined,
): Result<readonly string[], LenaError> {
  if (value === undefined) {
    return ok(Object.freeze([]));
  }

  if (!Array.isArray(value) || value.length === 0) {
    return err(new LenaError("invalid_input", "FTS columns must be a non-empty array"));
  }

  const columns: string[] = [];
  for (const column of value) {
    if (typeof column !== "string" || !COLUMN_PATTERN.test(column)) {
      return err(new LenaError("invalid_input", "Invalid FTS column name"));
    }
    columns.push(column);
  }

  return ok(Object.freeze(uniq(columns).toSorted(compareText)));
}

function hasForbiddenFtsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 8 ||
        (codePoint >= 11 && codePoint <= 12) ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127)
    ) {
      return true;
    }
  }
  return false;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
