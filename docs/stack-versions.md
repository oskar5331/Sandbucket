# Stack Versions — Sandbucket

**Verified against the npm registry and the Node.js release schedule on 2026-11-02**, and installed at bootstrap (M0) the same day.

This file pins the versions of the core stack named across `prd.md`. It exists for the reason given in `prd.md` §23: the §8 bundle budget is only checkable against known versions, and a self-hoster (§7) reproduces the stack from the documentation, so the documentation has to name what to reproduce. The decisions themselves (which package, and why) live in the PRD; this file records only *which version*.

At bootstrap, `package.json` uses these exact versions and `pnpm-lock.yaml` becomes the source of truth from then on. Upgrades are deliberate: bump the version here and in `package.json` in the same pull request, re-run the full §28 test suite, and update the verification date above.

## Runtime and tooling

| Component | Version | PRD ref | Notes |
|---|---|---|---|
| Node.js | **26** (26.13.0, Active LTS "Lithium") | §8, §23 | Active LTS since 2026-10-28, maintenance from 2027-10-20, end of life 2029-04-30. Docker base image and CI `setup-node` both use 26. |
| pnpm | 12.16.1 | §14 | Pinned via the `packageManager` field in `package.json`. |
| TypeScript | 6.0.3 | §14 | **Not 7.x (decided 2026-11-02).** At bootstrap, 7.0.2 type-checked correctly in both `tsc` and `next build`, but `typescript-eslint` (required by `eslint-config-next`) declares `typescript <6.1.0`, even on its canary channel, and refuses to load, so lint cannot run. Move to 7.x once `typescript-eslint` supports it (typescript-eslint issue #10940). |
| `@types/node` · `@types/react` · `@types/react-dom` | 26.6.6 · 19.3.0 · 19.3.0 | §14 | Match the Node 26 and React 19.3 majors. |

## Framework and UI

| Component | Version | PRD ref | Notes |
|---|---|---|---|
| Next.js (`next`) | 16.4.3 | §8, §17 | Requires Node ≥ 20.9. |
| React / React DOM | 19.3.1 | §8 | Newest stable; no React 20 exists. |
| Tailwind CSS | 4.3.3 | §15, §27 | |
| shadcn/ui | — (CLI only) | §15 | Not a runtime dependency; components are scaffolded into `components/ui/` and the Radix packages they import are pinned by the lockfile. |
| sonner | 2.0.8 | §15, §23(b) | Toasts. |
| react-hook-form | 7.91.0 | §13, §15 | |
| `@hookform/resolvers` | 7.0.1 | §13 | Supports Zod 4 and react-hook-form ≥ 7.55. |
| Zod | 4.6.7 | §13, §23 | `zod/mini` is the bundle-size escape hatch (§23). |
| next-intl | 4.14.9 | §16 | |
| Serwist (`@serwist/next`, `serwist`, `@serwist/cli`) | 9.5.13 | §6.16, §23 | Service worker and PWA manifest. |
| jSquash (`@jsquash/jpeg`) | 1.6.0 | §3, §23(a) | MozJPEG encoder. No release since 2025-05; stable but slow-moving. |

## Data, auth and storage

| Component | Version | PRD ref | Notes |
|---|---|---|---|
| PostgreSQL | **17** (major) | §18 | Plain Postgres, no vendor extensions. Used by `compose.yaml`, the devcontainer and CI. Supported until 2029-11-08. 18 is the current major; 17 was chosen on 2026-11-02. Fly isn't provisioned until M11 (`roadmap.md` Q2), so confirm then that Managed Postgres offers 17, and keep every environment on the same major. |
| Postgres image | `postgres:17.11-bookworm` | §18, §28 | `compose.yaml` and the CI service container. A test asserts both use the same tag. |
| Garage (`dxflrs/garage`) | v2.5.0 | §8, §20 | Self-host, local dev and CI object store. Replaced MinIO on 2026-11-03: MinIO's repository is archived and its Docker Hub image is gone. AGPL-3.0, runs as a separate service, so it doesn't affect the app's MIT license. |
| `pg` | 8.23.1 | §8 | Connection pool. |
| `uuidv7` | 1.2.1 | §6 | Primary keys, generated in Node. |
| Kysely | 0.29.8 | §8, §18 | Requires Node ≥ 22. |
| kysely-codegen | 0.20.0 | §18 | Type generation from the migrated schema. |
| dbmate | 2.37.0 | §18 | Migrations. |
| better-auth | 1.7.15 | §21 | |
| AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) | 3.1161.0 | §20 | Same code against Tigris (hosted) and Garage (self-host). |
| Resend (`resend`) | 6.37.0 | §22 | Hosted email. |
| Nodemailer | 10.3.1 | §22 | SMTP for self-host. |

## Testing and linting

| Component | Version | PRD ref | Notes |
|---|---|---|---|
| Vitest | 5.0.5 | §28 | Supports Node 26. |
| Playwright (`@playwright/test`) | 1.64.1 | §28 | |
| ESLint | 10.14.0 | §12 | Hosts the `no-restricted-imports` quarantine rule for `lib/db/unsafe.ts`. |
| `eslint-config-next` | 16.4.3 | §12 | Matches the Next.js version. |
| `actions/checkout` | v7.0.1 | §29 | Pinned by exact tag in `.github/workflows/pr.yml`; a test keeps the workflow and this table in step. |
| `actions/setup-node` | v7.1.0 | §29 | Reads Node from `.node-version`. |
| `actions/upload-artifact` | v7.0.2 | §29 | Uploads the Playwright report when e2e fails. |
| size-limit (`size-limit`, `@size-limit/file`) | 14.3.0 | §8, §29 | Initial-JS budget. Config in `.size-limit.js` reads the route list from the build output. |

## Compatibility check (2026-10-31)

Declared `engines` and peer ranges were checked for every package above. No package caps Node below 26, everything React-facing accepts React 19, and better-auth and next-intl accept Next 16. This is a check of declared ranges only, not an install; the first `pnpm install` at bootstrap is the real test.

## Bootstrap install (2026-11-02)

The first `pnpm install` was the real test the check above deferred to. It found one conflict the declared-range check had missed, because `typescript-eslint` is a transitive dependency of `eslint-config-next` and wasn't in the checked list: its `typescript <6.1.0` cap. TypeScript is pinned to 6.0.3 as a result (row above). All other peer ranges were re-checked and are compatible.
