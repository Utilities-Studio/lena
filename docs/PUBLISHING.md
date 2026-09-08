# Publishing Lena packages

Lena publishes public packages under `@lena-inc/*` from
<https://github.com/utilities-studio/lena>. Package versions start at `0.1.0`.

The first publication is a local owner-run bootstrap. Later publications use npm trusted
publishing from GitHub Actions with short-lived OIDC credentials. Agents never execute either
publication path.

## Package order

Publish dependencies before their consumers:

1. `core`
2. `vault`
3. `op-sqlite`
4. `expo-sqlite`
5. `backup`
6. `manual-backup`
7. `icloud`
8. `google-drive`
9. `search`
10. `ai`
11. `storekit`
12. `gps`
13. `sync`

## One-time npm preparation

The owner must create or control the npm organization or user scope `lena-inc`, enable account
two-factor authentication, and have permission to create public packages in that scope.

All packages currently declare `license: UNLICENSED`. They are publicly installable after
publication, but publication does not grant open-source reuse rights. Choose and add an SPDX
license before bootstrap publication if public reuse is intended.

Do not bootstrap while `@lena-inc/storekit` tests and builds against `expo-iap@5.5.0` but declares
the exact host peer as `5.4.1`. The owner must approve one exact version, then the development
dependency, peer dependency, lockfile, dependency record, source gate, and package archive must
agree.

## First publication from the owner's machine

Run the repository gate first:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

Inspect the package payloads without publishing:

```sh
for package in core vault op-sqlite expo-sqlite backup manual-backup icloud google-drive search ai storekit gps sync; do
  (cd "packages/$package" && npm pack --dry-run --ignore-scripts)
done
```

After the package names, versions, files, dependency ranges, and license are accepted, the owner
runs the irreversible bootstrap publication:

```sh
bun run release:publish
```

Changesets queries npm, skips versions that already exist, and publishes new versions in dependency
order through npm. Internal Lena dependencies use exact released versions, so no workspace protocol
can enter a package. The first local publication has no GitHub provenance attestation. A published
package name and version cannot be reused.

## Enable GitHub trusted publishing after bootstrap

Create a protected GitHub environment named `npm-publish`. Restrict it to `main` and add a required
reviewer when the repository plan supports environment protection.

For each of the 13 packages on npm, add a GitHub Actions trusted publisher with these exact values:

- GitHub organization: `utilities-studio`
- Repository: `lena`
- Workflow filename: `publish.yml`
- Environment: `npm-publish`
- Allowed action: `npm publish`

Do not add `NPM_TOKEN` to the workflow. The workflow grants only `contents: read` and
`id-token: write`; npm exchanges the GitHub identity for a short-lived publish credential.

The workflow uses a GitHub-hosted runner, Node 24, npm trusted publishing, Bun for installation and
quality checks, and the same Changesets publication command used during bootstrap. Changesets calls
npm, publishes in dependency order, and skips package versions that already exist.

Automatic npm provenance is emitted only when the npm package and GitHub repository are public.

## Future release cycle

Create a Changeset with:

```sh
bun run changeset
```

Apply accepted version and changelog changes with:

```sh
bun run release:version
bun install --ignore-scripts
bun run check
```

Changesets updates manifests and changelogs but does not update `bun.lock`; the Bun install is
therefore required before the version changes reach `main`. An owner then manually runs the
**Publish packages** workflow. The `npm-publish` environment approval remains the final release
gate.

## Primary references

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
- [GitHub OIDC permissions](https://docs.github.com/en/actions/reference/security/oidc)
- [GitHub environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Bun workspace publishing](https://bun.sh/docs/pm/workspaces)
- [Changesets commands](https://github.com/changesets/changesets/blob/main/docs/command-line-options.md)
