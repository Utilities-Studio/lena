# Publishing Lena packages

Lena publishes public `@lena-inc/*` packages from
<https://github.com/Utilities-Studio/lena>. Lerna-Lite owns package discovery, independent
versions, changelogs, internal dependency updates, lockfile synchronization, commits, tags, and
publication. Infra owns the shared CI workflow. Agents never execute versioning, publication,
Git, npm trust configuration, or infrastructure commands.

Oxfmt excludes Lerna-generated `packages/*/CHANGELOG.md` files because Lerna owns their formatting.
Handwritten documentation remains covered by the formatting check.

## Release contract

The root scripts match Infra's defaults, without workflow command overrides:

| Script            | Command                            | Responsibility                                                       |
| ----------------- | ---------------------------------- | -------------------------------------------------------------------- |
| `check`           | Existing Lena quality gate         | Format, build, validate artifacts, lint, test, and audit             |
| `release:version` | `lerna version --yes`              | Version changed packages, update the lockfile, commit, tag, and push |
| `release:publish` | `lerna publish from-package --yes` | Publish current package versions missing from npm                    |

`lerna.json` configures Bun, independent conventional-commit versions, the `conventionalcommits`
preset, `main` as the release branch, and documentation/test-path exclusions. `exact: true`
preserves exact internal Lena dependency versions. `syncWorkspaceLock` refreshes `bun.lock`
through Bun with lifecycle scripts and automatic environment-file loading disabled.

The caller is `.github/workflows/publish.yml`, pinned to Infra commit
`9609ba74b576fe3eee32fa2ac5394ab750b240c4`. It grants only `contents: write` and
`id-token: write`. Runtime setup, default-branch validation, concurrency, the `npm-publish`
environment, installation, verification, and version/publish steps belong to Infra.

## One-time owner setup

Before the first release:

1. Control the npm `lena-inc` scope, enable account 2FA, and obtain package write access.
2. Review the package names, versions, dependency ranges, artifacts, and license. Packages currently
   declare `UNLICENSED`; public installation does not grant open-source reuse rights.
3. Reconcile source versions and release tags with packages already published. This tooling
   migration does not change package versions or create historical tags.
4. Create or retain the `npm-publish` GitHub environment, restrict it to `main`, and retain any
   required release approval.
5. Ensure branch and tag rules permit the workflow's direct release commits and tags. Required-PR
   or signed-commit rules can block this workflow. It does not bypass those rules or change GitHub
   settings.

The first publication for packages not yet on npm is owner-run locally:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run release:publish
```

Authenticate with npm first. Lerna-Lite publishes dependency-first and skips existing versions.
`from-package` publishes the versions already in the manifests; it does not run the separate
versioning step. A published package name and version cannot be reused. Local bootstrap does not
have GitHub provenance.

## npm trusted publishing

Every package must trust this unchanged caller identity:

- GitHub organization: `Utilities-Studio`
- Repository: `lena`
- Workflow: `publish.yml`
- Environment: `npm-publish`
- Allowed action: direct npm publishing

These fields are case-sensitive. Use `Utilities-Studio`, not `utilities-studio`; GitHub URL
redirects do not make npm's identity checks case-insensitive. The root and every published
package manifest use `git+https://github.com/Utilities-Studio/lena.git` as their repository URL.

Changing repository metadata or this guide does not update saved npm trusted-publisher settings.
The owner must correct any mismatched settings on each package in npm before rerunning the
workflow. A registry `E404` for an existing package can indicate an authorization failure, not a
missing package; inspect the saved identity and direct-publishing permission before retrying.

After initial publication and npm login, the owner can configure all packages from the Lena root:

```sh
bunx @utilities-studio/npm-trust@latest
```

The CLI infers the repository from `origin` and defaults to `publish.yml`, `npm-publish`, and
direct publishing. If the inferred organization has different casing, use the package's npm
settings to configure the exact identity above instead. **It applies immediately, not as a
preview.** Matching records are skipped;
differing records are revoked and replaced. Replacement is not atomic: failed creation after
revocation can leave a package without a trusted publisher. Other packages continue, and the CLI
reports remaining failures after the batch. Rerunning skips completed packages.

Initial setup requires authenticated npm access and 2FA. Later publishing uses GitHub OIDC with no
`NPM_TOKEN`. npm validates Lena's repository and caller workflow, not Infra's repository or
`npm-publish.yml`. Existing matching Lena trust records need no changes merely because the release
engine changed.

## Normal releases

Commit package changes using conventional commits. For stable packages, `feat:` requests a minor
bump and a breaking-change marker requests a major bump. Other selected code changes receive at
least a patch bump; documentation/test-only paths are ignored. Pre-1.0 packages follow Lerna-Lite's
premajor rules.

Pushes to `main` automatically start **Publish packages**. Manual dispatch remains available.
Lerna-Lite determines which packages need versioning or publication.

The workflow checks out the latest default branch, runs Lena's quality gate, then versions,
commits, tags, and publishes. There is no version PR or pending changeset file. Version commits
include `[skip ci]`. The existing environment approval, if configured, applies to the release job.

If publishing fails after versioning, the version commit and tags may already exist. Rerun the
workflow after resolving the failure: `from-package` checks current manifest versions against npm
and publishes missing versions even when no new version bump is needed. A rerun uses the latest
`main`, not necessarily the original run's commit.

Do not run `release:version` as a status check. It writes versions, commits, tags, and pushes.
No local test proves npm authorization, GitHub branch permissions, or successful publication;
those require owner-run workflow evidence.

## References

- [Infra release workflow](https://github.com/Utilities-Studio/infra/blob/9609ba74b576fe3eee32fa2ac5394ab750b240c4/.github/workflows/npm-publish.yml)
- [Lerna-Lite version](https://github.com/lerna-lite/lerna-lite/tree/main/packages/version)
- [Lerna-Lite publish and OIDC](https://github.com/lerna-lite/lerna-lite/tree/main/packages/publish)
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
