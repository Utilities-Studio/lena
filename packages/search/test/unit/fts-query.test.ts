import { describe, expect, test } from "bun:test";
import { ok } from "@lena/core";
import { buildFts5Query } from "../../src/index";

describe("safe FTS5 query construction", () => {
  test("quotes text so FTS operators remain data", () => {
    const query = buildFts5Query({
      clauses: [
        { kind: "term", text: "OR" },
        { kind: "phrase", text: 'hello" OR private*' },
      ],
      mode: "any",
    });

    expect(query).toEqual(
      ok({
        clauseCount: 2,
        matchParameter: '("OR") OR ("hello"" OR private*")',
      }),
    );
  });

  test("builds a prefix and deterministic column filter", () => {
    const query = buildFts5Query({
      clauses: [{ columns: ["title", "body", "title"], kind: "prefix", text: "旅" }],
      mode: "all",
    });

    expect(query).toEqual(
      ok({
        clauseCount: 1,
        matchParameter: '({body title} : "旅" *)',
      }),
    );
  });

  test("normalizes Unicode and whitespace deterministically", () => {
    const query = buildFts5Query({
      clauses: [{ kind: "phrase", text: "  Cafe\u0301\n  visit  " }],
      mode: "all",
    });

    expect(query.isOk() && query.value.matchParameter).toBe('("Café visit")');
  });

  test("rejects empty text, multiword terms, controls, and column injection", () => {
    expect(buildFts5Query({ clauses: [{ kind: "term", text: " " }], mode: "all" }).isOk()).toBe(
      false,
    );
    expect(
      buildFts5Query({
        clauses: [{ kind: "term", text: "two words" }],
        mode: "all",
      }).isOk(),
    ).toBe(false);
    expect(
      buildFts5Query({ clauses: [{ kind: "phrase", text: "a\u0000b" }], mode: "all" }).isOk(),
    ).toBe(false);
    expect(
      buildFts5Query({
        clauses: [{ columns: ["title} OR body"], kind: "term", text: "safe" }],
        mode: "all",
      }).isOk(),
    ).toBe(false);
  });
});
