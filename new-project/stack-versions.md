# Stack Versions — Sandbucket

**Verified against the npm registry and the Node.js release schedule on 2026-10-31.**

This file pins the versions of the core stack named across `prd.md`. It exists for the reason given in `prd.md` §23: the §8 bundle budget is only checkable against known versions, and a self-hoster (§7) reproduces the stack from the documentation, so the documentation has to name what to reproduce. The decisions themselves (which package, and why) live in the PRD; this file records only *which version*.

At bootstrap, `package.json` uses these exact versions and `pnpm-lock.yaml` becomes the source of truth from then on. Upgrades are deliberate: bump the version here and in `package.json` in the same pull request, re-run the full §28 test suite, and update the verification date above.

## Runtime and tooling

| Component | Version | PRD ref | Notes |
|---|---|---|---|
| Node.js | **26** (26.13.0, Active LTS "Lithium") | §8, §23 | Active LTS since 2026-10-28, maintenance from 2027-10-20, end of life 2029-04-30. Docker base image and CI `setup-node` both use 26. |
| pnpm | 12.16.1 | §14 | Pinned via the `packageManager` field in `package.json`. |
| TypeScript | 7.0.2 | §14 | The native-compiler release. Confirm `next build` type-checking works with it at bootstrap; if not, fall back to 6.0.3 and record that here. |

## Framework and UI

| Component | Version | PRD ref | Notes |
|---|---|---|---|
| Next.js (`next`) | 16.4.3 | §8, §17 | Requires Node ≥ 20.9. |
| React / React DOM | 19.3.1 | §8 | Newest stable; no React 20 exists. |
| Tailwind CSS | 4.3.3 | §15, §27 | |
| shadcn/ui | — (CLI only) | §15 | Not a runtime dependency; components are scaffolded into `components/ui/` and the Radix packages they import are pinned by the lockfile. |
| sonner | 2.0.8 | §15, §23(b) | Toasts. |
| react-hook-form | 7.91.0 | §13, §15 | |
| `@hookform/resolvers` | 7.0.0 | §13 | Supports Zod 4 and react-hook-form ≥ 7.55. |
| Zod | 4.6.7 | §13, §23 | `zod/mini` is the bundle-size escape hatch (§23). |
| next-intl | 4.14.9 | §16 | |
| Serwist (`@serwist/next`, `serwist`, `@serwist/cli`) | 9.5.13 | §6.16, §23 | Service worker and PWA manifest. |
| jSquash (`@jsquash/jpeg`) | 1.6.0 | §3, §23(a) | MozJPEG encoder. No release since 2025-05; stable but slow-moving. |

## Data, auth and storage

| Component | Version | PRD ref | Notes |
|---|---|---|---|
| PostgreSQL | Fly Managed Postgres default; same major in `compose.yaml` | §18 | Plain Postgres, no vendor extensions. Match the self-host image's major version to the one Fly reports at provisioning. |
| `pg` | 8.23.1 | §8 | Connection pool. |
| Kysely | 0.29.7 | §8, §18 | Requires Node ≥ 22. |
| kysely-codegen | 0.20.0 | §18 | Type generation from the migrated schema. |
| dbmate | 2.37.0 | §18 | Migrations. |
| better-auth | 1.7.14 | §21 | |
| AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) | 3.1161.0 | §20 | Same code against Tigris (hosted) and MinIO (self-host). |
| Resend (`resend`) | 6.37.0 | §22 | Hosted email. |
| Nodemailer | 10.3.1 | §22 | SMTP for self-host. |

## Testing and linting

| Component | Version | PRD ref | Notes |
|---|---|---|---|
| Vitest | 5.0.5 | §28 | Supports Node 26. |
| Playwright (`@playwright/test`) | 1.64.1 | §28 | |
| ESLint | 10.14.0 | §12 | Hosts the `no-restricted-imports` quarantine rule for `lib/db/unsafe.ts`. |
| `eslint-config-next` | 16.4.3 | §12 | Matches the Next.js version. |

## Compatibility check (2026-10-31)

Declared `engines` and peer ranges were checked for every package above. No package caps Node below 26, everything React-facing accepts React 19, and better-auth and next-intl accept Next 16. This is a check of declared ranges only, not an install; the first `pnpm install` at bootstrap is the real test.
