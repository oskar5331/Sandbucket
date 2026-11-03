# Default Configuration & Setup Script

Describes what gets seeded on first deploy and on new profile creation. Also defines the full role structure.

---

## 1. Roles

Two scopes: **Platform** (global, across all profiles) and **Tenant** (scoped to a single bookkeeping profile).

### 1.1 Platform Role

| Role | Scope | Description |
|---|---|---|
| `admin` | Platform-global | Manages all users and platform configuration. Zero visibility into any tenant's bookkeeping data — isolation is enforced at the database layer, not by policy. Can be explicitly connected to a tenant account by that tenant's `owner`; only then can they switch into that tenant's context. Assigned to the first deploy user via seed script. |

One platform role exists. The `admin` has their own isolated operational scope — they see users, registration dates, account status, and platform metrics. They never see transactions, records, parties, or balances unless a tenant `owner` explicitly grants them access.

### 1.2 Tenant Roles

Scoped to a single profile. Profile sharing ships in MVP (`prd.md` §6.20, §32): the creating user gets `owner`, and the owner invites others by email as `accountant` or `worker`.

| Role | Who it is | Create transactions | Edit / delete transactions | Manage parties | Export | Profile settings & members |
|---|---|---|---|---|---|---|
| `owner` | Profile creator, or whoever ownership was transferred to. Exactly one per profile. | ✅ All 9 types | ✅ Any | ✅ Create, edit, deactivate | ✅ Yes (v2) | ✅ Yes |
| `accountant` | Invited bookkeeper. Multiple per profile. | ✅ All 9 types | ✅ Only ones they created | ✅ Create & edit, no deactivate | ❌ No | ❌ No |
| `worker` | Invited employee or contractor, typically a cash custodian. Multiple per profile. | Expense only, paid from their own register or personally | ✅ Only their own, until an owner or accountant has edited it | ❌ No | ❌ No | ❌ No |

**Notes:**
- A `worker` sees only their own entries and their own cash register — no other transactions, no balance sheet. Supersedes the legacy `viewer` concept.
- Each member is linked to at most one Partner or Worker party in the profile (`prd.md` §32). The link pre-fills forms and scopes the worker view.
- Editing a transaction means changing date, description, and amount on an existing TransactionGroup. Changing the credit/debit party wiring is not supported — that requires deleting and re-entering the transaction.
- Parties with linked Records cannot be hard-deleted — they can only be deactivated.
- Export is v2 (`prd.md` §6, out of scope); when it ships it is `owner`-only.
- The platform `admin` can be connected to a tenant profile by its `owner`. When connected, the `admin` operates within that profile with `owner`-equivalent access. All actions taken under a connected session are logged with the admin's identity and a timestamp.

### 1.3 Role Mapping vs Legacy System

| Legacy (Mendix) | New role | Notes |
|---|---|---|
| `Administrator` | `admin` (platform) | System-level, no tenant data access by default |
| `SuperAccountant` | `owner` | Full tenant profile access |
| `Accountant` | `accountant` | Create transactions, manage parties |
| `AccountantManager` | Merged into `accountant` | Delta was two microflows — not worth a separate role |
| `BasicUser` | `worker` | Concept kept but redesigned — expense entry from their own cash, no balance sheet visibility |
| `Anonymous` | Removed | No anonymous access in new app |

---

## 2. Platform Seed (first deploy only)

Runs once when the platform is first deployed. Creates the `admin` account.

```
user:
  email:    [set via environment variable ADMIN_EMAIL]
  password: [set via environment variable ADMIN_INITIAL_PASSWORD]
  role:     admin
  profile:  none — platform admin has no bookkeeping profile by default
```

Both `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD` must be set before first boot. If either is missing the seed script aborts and the deploy fails — there is no default credential.

---

## 3. Profile Seed (on every new profile creation)

Runs automatically when a user creates a new profile. Seeds system parties and default configuration. All seeded data is owned by the profile and isolated by the profile-scoped accessor plus the RLS backstop (`prd.md` §19). The seed itself runs on the owner-role handle (§12), since no membership exists yet to scope against.

### 3.1 Party Types

Every party has a type. Types control two things: how the party is used in transaction wiring, and whether it can be linked to a real user account.

| Type | User-assignable | Notes |
|---|---|---|
| `bank` | ❌ | Ledger account for bank balances |
| `cash_register` | ❌ | Ledger account for cash on hand |
| `profits` | ❌ | Internal credit account — auto-wired on issued invoices |
| `expenses` | ❌ | Internal debit account — auto-wired on received invoices (cost type) |
| `investment` | ❌ | Ledger account for investment capital |
| `supplier` | ❌ | External party money flows to |
| `customer` | ❌ | External party money flows from |
| `partner` | ✅ | Business partner or co-owner — can be linked to a user account |
| `worker` | ✅ | Employee or contractor — can be linked to a user account |
| `opening_balances` | ❌ | System-only: seeded once per profile, never user-created. Counter-party for "Set Opening Balance" Records (`prd.md` §6.17, §25) |

When a `partner` or `worker` party is linked to a user account, the profile `owner` assigns that user any tenant role (`owner`, `accountant`, or `worker`). The role governs their access; the party type declares that the slot for a real person exists.

### 3.2 System Parties

Marked `is_system = true`. Cannot be deleted. Can be renamed by the `owner`. The app resolves them by `system_key`, not by name, so renaming is always safe.

| system_key | Default name (EN) | Default name (ET) | Party type | Purpose |
|---|---|---|---|---|
| `bank` | Main Bank Account | Põhikonto | `bank` | Default source/destination for direct transfers |
| `cash_register` | Cash Register | Kassaregister | `cash_register` | Cash on hand |
| `profits` | Revenue | Tulud | `profits` | Internal credit account — auto-wired on issued invoices |
| `expenses` | Expenses | Kulud | `expenses` | Internal debit account — auto-wired on received invoices (cost type) |
| `opening_balances` | Opening Balances | Algsaldod | `opening_balances` | Counter-party for opening-balance entries (`prd.md` §6.17, §25) |

### 3.3 Default Profile Settings

```
currency:          EUR
```

Currency is the only per-profile setting (`prd.md` §10). Everything else is fixed app-wide and is not stored on the profile (decided 2026-11-02):

- **UI language** (`en` / `et`): per device, via the `NEXT_LOCALE` cookie (`prd.md` §16).
- **Date and number format:** DD.MM.YYYY and Estonian number rules in both languages (`prd.md` §6.15, §16).
- **Fiscal year:** calendar year. No setting and no column until a feature needs one.

---

## 4. Account Management

### 4.1 Registration
- Open registration enabled by default on the hosted version
- Self-hosters can disable public sign-up via `ALLOW_REGISTRATION=false`; only the `admin` can then create new user accounts
- Email must be verified via the better-auth confirmation link before first login is permitted (`prd.md` §21)

### 4.2 Profile Creation
- On first login a default profile is created automatically, named from the user's email local-part (e.g. `kaja@example.test → Kaja`) — editable immediately
- Additional profiles can be created at any time from the profile switcher
- No profile limit per user in MVP

### 4.3 Platform Admin (`admin`) Capabilities
Accessible at `/admin`, not linked from the main app navigation.

- View all registered users: email, registration date, profile count, last active timestamp
- Disable / re-enable a user account
- Delete a user account and all associated profiles and data (GDPR erasure)
- Connect to a tenant profile (requires explicit grant from the tenant `owner`); all actions in a connected session are logged
- View platform metrics: total users, total profiles, total transaction count

The `admin` UI is fully isolated from the main bookkeeping app — separate routes, separate navigation, and its own access path to data that bypasses the profile-scoped accessor only through the quarantined module of `prd.md` §12.

### 4.4 Auth
- Email + password via **better-auth** (`prd.md` §21); minimum 10 characters, no composition rules, no lockout, built-in rate limiting
- Email one-time codes are the planned follow-on sign-in method, not MVP
- Password reset via emailed single-use link; transactional email per `prd.md` §22 (Resend hosted / SMTP self-host)
- Sessions are httpOnly + Secure + SameSite=Lax cookies, scoped to the user account, not to a profile — switching profiles does not require re-authentication
- Profile isolation is enforced by the per-request profile-scoped accessor (`prd.md` §19), with Postgres RLS on every tenant-scoped table as a database backstop, a lint quarantine on the RLS-bypassing owner-role handle (§12), and per-table cross-tenant integration tests.

---

## 5. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ADMIN_EMAIL` | Yes (first deploy) | none | Email address for the platform admin account |
| `ADMIN_INITIAL_PASSWORD` | Yes (first deploy) | none | Initial password for the platform admin. Seed aborts if unset. |
| `ALLOW_REGISTRATION` | No | `true` | Set to `false` to disable public sign-up |
| `DATABASE_URL` | Yes | none | Postgres connection string for the **`sandbucket_app`** role — all request traffic, subject to RLS (`prd.md` §19). Hosted: Fly Managed Postgres over the org's private network. Self-host: the Compose `postgres` service. Server-side only. |
| `DATABASE_OWNER_URL` | Yes | none | Connection string for the **`sandbucket_owner`** role — runs dbmate migrations (`release_command`, `prd.md` §29) and backs the quarantined bootstrap handle (§12). Bypasses RLS. Server-side only. |
| `BETTER_AUTH_SECRET` | Yes | none | Signing secret for better-auth sessions and tokens (`prd.md` §21) |
| `BETTER_AUTH_URL` | Yes | none | Canonical base URL better-auth issues cookies and links against |
| `BUCKET_NAME` | Yes | none | Object-storage bucket for attachments (`prd.md` §20). Set automatically by `fly storage create`. |
| `AWS_ENDPOINT_URL_S3` | Yes | none | S3 endpoint the server uses — Tigris (`https://t3.storage.dev`) hosted, Garage self-host (`http://garage:3900` inside Compose) |
| `S3_PUBLIC_ENDPOINT_URL` | No | `AWS_ENDPOINT_URL_S3` | Endpoint presigned URLs are signed against, i.e. the one the browser can reach (`prd.md` §20). Set it when that differs from the server's, e.g. `http://localhost:3900` for local Compose. |
| `AWS_ACCESS_KEY_ID` | Yes | none | Object-storage access key. Tigris shows this once at bucket creation and cannot re-issue it — capture it then. |
| `AWS_SECRET_ACCESS_KEY` | Yes | none | Object-storage secret key. Same one-time-only caveat. Server-side only. |
| `GARAGE_RPC_SECRET` | Self-host | none | Garage node secret, 32 bytes hex (`openssl rand -hex 32`). Used only by the `garage` Compose service. |
| `GARAGE_ADMIN_TOKEN` | Self-host | none | Garage admin API token (`openssl rand -base64 32`). Used only by the one-shot `storage-init` service to create the bucket, key and CORS rule. |
| `RESEND_API_KEY` | Hosted | none | Transactional email provider key (`prd.md` §22). Omit when using SMTP. |
| `SMTP_URL` | Self-host | none | SMTP connection string used instead of Resend. One of `RESEND_API_KEY` / `SMTP_URL` must be set. |
| `EMAIL_FROM` | Yes | none | Sender address for verification, reset, and OTP mail |
| `NEXT_PUBLIC_APP_URL` | Yes | none | Public URL of the deployed app (used in auth email links) |

No key in this table is exposed to the browser except `NEXT_PUBLIC_APP_URL`. Database credentials, storage keys, the better-auth secret, and the email provider key are read only in the Next.js Node runtime — as Fly secrets on the hosted deployment (`prd.md` §17), as Compose environment on self-host.
