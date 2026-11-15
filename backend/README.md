# Backend

The Supabase project is in `supabase/`. Edge Function source is kept in the requested `functions/` directory; `supabase/functions/` contains small CLI entrypoints that import that source.

## Supported starter routes

- `submit-report`: authenticated-only intake; validates and normalizes a domain, URL, or international/Pakistan-format phone number, encrypts the submitted/canonical value, HMACs the canonical value, and calls a narrow report RPC.
- `get-own-report`: returns a status-only projection after the database confirms report ownership.
- `upload-evidence`: authorizes a five-minute, user-bound upload ticket and streams a bounded, signature-checked file into the private quarantine bucket. The endpoint hashes the file server-side; browser roles cannot read the bucket or evidence metadata.
- `moderator-review`: returns assigned reports, records triage decisions and source-backed verification, and creates one-minute signed evidence previews only after quarantine release.
- `approve-indicator`: provides the publication queue to senior reviewers and publishes only after a distinct second reviewer approves.
- `analyst-cases`: returns sanitized briefs, claims cases under a 24-hour timer, enforces concurrent capacity, and returns the analyst's own contribution stats.
- `submit-finding`: accepts structured, source-linked findings from an active assignee; mentors and senior reviewers can record scoped feedback.
- `team-chat`: returns role-scoped rooms and writes PII-screened messages. Message reads use table RLS and Supabase Realtime.
- `assign-case`, `challenge-indicator`, `create-dossier`, `approve-disclosure`, `create-feed-release`, `report-abuse`: return `501` until their remaining assignment, disclosure, abuse, and release controls are implemented.
- `compile-feed`: platform-admin-only compilation; decrypts approved indicator values server-side, strips report and victim fields, signs canonical JSON with Ed25519, and records the release.
- `feed-snapshot`: returns the current signed public snapshot, or `503` when no valid active release exists.

Citizen reporting and collaboration handlers use caller-scoped publishable clients and narrow RPCs. Only `upload-evidence` and `moderator-review` use the service-role key server-side: for private Storage writes/completion and short-lived evidence preview URLs. It is never sent to the browser.

## Secrets

Set these only as Supabase Edge Function secrets:

- `INDICATOR_ENCRYPTION_KEY`: base64 for 32 random bytes used by AES-256-GCM.
- `INDICATOR_HMAC_KEY`: an independent base64 32-byte secret used for keyed SHA-256 lookup hashes.
- `INDICATOR_HMAC_KEY_VERSION`: short identifier such as `v1`; rotate with a migration and dual-key lookup plan.
- `EVIDENCE_UPLOAD_HMAC_KEY`: independent base64-encoded 32-byte key for signing short-lived evidence upload tickets.
- `FEED_SIGNING_KEY_ID`: active public key identifier registered in `private.feed_signing_keys`.
- `FEED_SIGNING_PRIVATE_KEY_PKCS8`: base64-encoded Ed25519 PKCS#8 private key. Keep only in Supabase Edge Function secrets; never add it to the repository or extension.
- `ALLOWED_ORIGINS`: comma-separated exact portal origins, including local development origins where needed.

Supabase provides the project URL and a publishable/anon key to the Edge Function runtime (`SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`). The service-role key is used only inside the evidence upload and moderator preview handlers and must never be passed to a browser.

For `upload-evidence` and moderator evidence previews, the Edge Function runtime must provide `SUPABASE_SERVICE_ROLE_KEY` (the local Supabase runtime normally supplies it). Uploaded files remain private and pending until a scanning workflow marks them clean and releases quarantine. No preview URL is created before that transition.

Publication requires two-person review: an assigned moderator records independent public-source verification, then a distinct senior reviewer approves or rejects. Approved indicators become eligible for a later signed feed release. Register the matching 32-byte Ed25519 raw public key with `public.register_feed_signing_key`, configure the private PKCS#8 key and matching ID as function secrets, then invoke `compile-feed` as a platform admin. Add the registered public key to `extension/config.js`. The compiler currently uses the active `INDICATOR_ENCRYPTION_KEY`; rotating indicator encryption keys requires a decrypt key ring before historical indicators can be compiled.

## Role provisioning

New accounts receive only the `citizen` role. Staff roles require identity vetting and an authorized database-side grant with a scope, expiry, reason code, and grantor. Never provision roles through frontend metadata, public signup fields, or direct browser writes. The starter does not include a self-service staff onboarding endpoint.

`rls_policies.sql` duplicates the RLS migration for review. Apply migrations with the Supabase CLI rather than running the standalone copy after a reset.
