import { expect, test } from "bun:test";
import { array, assert, constantFrom, integer, property } from "fast-check";

import { parseSyncChangeId, parseSyncProtocolVersion } from "../../src";

const TOKEN_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-";

test("generated protocol versions and bounded identifiers satisfy their Zod contracts", () => {
  assert(
    property(
      integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
      constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"),
      array(constantFrom(...TOKEN_CHARACTERS), { maxLength: 159 }),
      (version, first, rest) => {
        expect(parseSyncProtocolVersion(version).isOk()).toBe(true);
        expect(parseSyncChangeId(`${first}${rest.join("")}`).isOk()).toBe(true);
      },
    ),
  );
});
