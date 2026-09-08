import { expect, test } from "bun:test";
import { assert, integer, property, uuid } from "fast-check";

import { parseSyncChangeId, parseSyncProtocolVersion } from "../../src";

test("generated protocol versions and bounded identifiers satisfy their Zod contracts", () => {
  assert(
    property(
      integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
      uuid({ version: 4 }),
      (version, identifier) => {
        expect(parseSyncProtocolVersion(version).isOk()).toBe(true);
        expect(parseSyncChangeId(identifier).isOk()).toBe(true);
      },
    ),
  );
});
