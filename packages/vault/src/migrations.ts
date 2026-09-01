import { err, LenaError, ok, type Result, type SchemaVersion } from "@lena/core";

export interface VaultMigrationDescriptor {
  readonly from: SchemaVersion;
  readonly id: string;
  readonly to: SchemaVersion;
}

export function planVaultMigrations(
  current: SchemaVersion,
  target: SchemaVersion,
  available: readonly VaultMigrationDescriptor[],
): Result<readonly VaultMigrationDescriptor[], LenaError> {
  if (current > target) {
    return err(
      new LenaError("incompatible_schema", "Vault downgrade is not supported", {
        current,
        target,
      }),
    );
  }

  if (current === target) return ok(Object.freeze([]));

  const ids = new Set<string>();
  const fromVersions = new Set<number>();
  for (const migration of available) {
    if (migration.id.trim().length === 0 || ids.has(migration.id)) {
      return err(new LenaError("invalid_input", "Migration ids must be unique"));
    }
    if (migration.to !== migration.from + 1) {
      return err(
        new LenaError("invalid_input", "Migrations must advance exactly one schema version", {
          from: migration.from,
          to: migration.to,
        }),
      );
    }
    if (fromVersions.has(migration.from)) {
      return err(
        new LenaError("conflict", "Multiple migrations share a source version", {
          from: migration.from,
        }),
      );
    }
    ids.add(migration.id);
    fromVersions.add(migration.from);
  }

  const byFrom = new Map(available.map((item) => [item.from, item] as const));
  const planned: VaultMigrationDescriptor[] = [];
  let version: SchemaVersion = current;
  while (version < target) {
    const migration = byFrom.get(version);
    if (!migration) {
      return err(
        new LenaError("incompatible_schema", "Migration chain has a gap", {
          missingFrom: version,
        }),
      );
    }
    planned.push(migration);
    version = migration.to;
  }

  return ok(Object.freeze(planned));
}
