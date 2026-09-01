import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../../..");

function packageSource(packageName: string): string {
  const sourceDirectory = resolve(REPOSITORY_ROOT, "packages", packageName, "src");
  const files = readdirSync(sourceDirectory, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts"));
  return files.map((file) => readFileSync(resolve(sourceDirectory, file), "utf8")).join("\n");
}

describe("package trust boundaries", () => {
  test("core imports no other Lena package", () => {
    expect(packageSource("core")).not.toContain('from "@lena/');
  });

  test("payment and transports cannot import vault mutation authority", () => {
    for (const packageName of ["google-drive", "icloud", "manual-backup", "storekit"]) {
      expect(packageSource(packageName)).not.toContain('from "@lena/vault"');
    }
  });

  test("Private Vault packages cannot import Hosted Sync", () => {
    for (const packageName of [
      "ai",
      "backup",
      "core",
      "expo-sqlite",
      "google-drive",
      "gps",
      "icloud",
      "manual-backup",
      "op-sqlite",
      "search",
      "storekit",
      "vault",
    ]) {
      expect(packageSource(packageName)).not.toContain('from "@lena/sync"');
    }
  });

  test("Lena packages contain no application imports", () => {
    for (const packageName of [
      "ai",
      "backup",
      "core",
      "expo-sqlite",
      "google-drive",
      "gps",
      "icloud",
      "manual-backup",
      "op-sqlite",
      "search",
      "storekit",
      "sync",
      "vault",
    ]) {
      const source = packageSource(packageName);
      expect(source).not.toMatch(/(?:jetseen|becoming)\//i);
    }
  });
});
