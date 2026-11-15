# ClutterShield Pakistan

Starter workspace for the privacy-first reporting, review, analyst, and browser-shield platform described in the supplied product and technical specifications.

This is a development scaffold, not a production service. It implements authenticated report intake, private candidate indicators, own-report status reads, assigned moderator review, two-person indicator publication review, time-limited analyst assignments, structured finding review, role-scoped team chat, and private evidence intake into quarantine. Evidence scanning and retrieval, dossier disclosure, external feed signing, anonymous reporting, and partner integrations remain disabled until their controls and operating approvals are in place.

## Workspace layout

```text
cluttersheild-pakistan/
├── .gitignore
├── README.md
├── backend/
│   ├── README.md
│   ├── deno.json
│   ├── functions/
│   │   ├── README.md
│   │   ├── _shared/
│   │   │   ├── auth.ts
│   │   │   ├── crypto.ts
│   │   │   ├── http.ts
│   │   │   ├── indicator.ts
│   │   │   └── notImplemented.ts
│   │   ├── analyst-cases/index.ts
│   │   ├── approve-disclosure/index.ts
│   │   ├── approve-indicator/index.ts
│   │   ├── assign-case/index.ts
│   │   ├── challenge-indicator/index.ts
│   │   ├── create-dossier/index.ts
│   │   ├── create-feed-release/index.ts
│   │   ├── feed-snapshot/index.ts
│   │   ├── get-own-report/index.ts
│   │   ├── moderator-review/index.ts
│   │   ├── report-abuse/index.ts
│   │   ├── submit-finding/index.ts
│   │   ├── submit-report/index.ts
│   │   ├── team-chat/index.ts
│   │   └── upload-evidence/index.ts
│   └── supabase/
│       ├── config.toml
│       ├── rls_policies.sql
│       ├── functions/             # CLI shims importing backend/functions source
│       │   ├── analyst-cases/index.ts
│       │   ├── approve-disclosure/index.ts
│       │   ├── approve-indicator/index.ts
│       │   ├── assign-case/index.ts
│       │   ├── challenge-indicator/index.ts
│       │   ├── create-dossier/index.ts
│       │   ├── create-feed-release/index.ts
│       │   ├── feed-snapshot/index.ts
│       │   ├── get-own-report/index.ts
│       │   ├── moderator-review/index.ts
│       │   ├── report-abuse/index.ts
│       │   ├── submit-finding/index.ts
│       │   ├── submit-report/index.ts
│       │   ├── team-chat/index.ts
│       │   └── upload-evidence/index.ts
│       └── migrations/
│           ├── 202611150001_core_schema.sql
│           ├── 202611150002_narrow_rpc_flows.sql
│           ├── 202611150003_rls_policies.sql
│           ├── 202611150004_citizen_channel_and_status.sql
│           ├── 202611150005_citizen_evidence_upload.sql
│           └── 202611150006_moderator_hacker_modules.sql
├── extension/
│   ├── README.md
│   ├── background.js
│   ├── config.js
│   ├── manifest.json
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
└── frontend/
    ├── .env.example
    ├── index.html
    ├── package.json
    ├── public/
    │   ├── favicon.svg
    │   └── robots.txt
    ├── src/
    │   ├── App.tsx
    │   ├── main.tsx
    │   ├── index.css
    │   ├── types.ts
    │   ├── components/
    │   │   ├── collaboration/TeamChat.tsx
    │   │   ├── Footer.tsx
    │   │   ├── Modal.tsx
    │   │   ├── Navbar.tsx
    │   │   └── StatusPill.tsx
    │   ├── context/
    │   │   ├── AuthContext.tsx
    │   │   └── RoleGate.tsx
    │   ├── layouts/
    │   │   ├── CitizenLayout.tsx
    │   │   ├── DashboardLayout.tsx
    │   │   ├── HackerLayout.tsx
    │   │   └── ModeratorLayout.tsx
    │   ├── pages/
    │   │   ├── AuthPage.tsx
    │   │   ├── HomePage.tsx
    │   │   ├── citizen/
    │   │   │   ├── ReportFormPage.tsx
    │   │   │   ├── ReportScamPage.tsx
    │   │   │   ├── TrackReportPage.tsx
    │   │   │   └── TrackStatusPage.tsx
    │   │   ├── hacker/HackerWorkspace.tsx
    │   │   ├── hacker/CaseWorkspacePage.tsx
    │   │   ├── moderator/ModeratorDashboard.tsx
    │   │   └── moderator/ReviewQueuePage.tsx
    │   └── services/
    │       ├── analystService.ts
    │       ├── functionClient.ts
    │       ├── moderationService.ts
    │       ├── reportService.ts
    │       ├── teamService.ts
    │       ├── supabaseClient.ts
    │       └── supabase.ts
    ├── tailwind.config.js
    ├── tsconfig.json
    ├── vercel.json
    └── vite.config.ts
```

## Modules 2–3 implementation

- `frontend/src/pages/moderator/ModeratorDashboard.tsx` and `frontend/src/services/moderationService.ts` implement assigned triage, quarantined evidence previews, and a separate senior publication review queue.
- `frontend/src/pages/hacker/HackerWorkspace.tsx` and `frontend/src/services/analystService.ts` implement sanitized case claims, timed assignments, structured findings, mentor review, and contribution status.
- `frontend/src/components/collaboration/TeamChat.tsx` and `frontend/src/services/teamService.ts` provide RLS-scoped Realtime room messaging.
- `backend/supabase/migrations/202611150006_moderator_hacker_modules.sql` adds the module RPCs, private data policies, team message policies, claim concurrency controls, and publication review records.
- `backend/functions/compile-feed/index.ts` compiles approved indicators into a canonical Ed25519-signed release; `extension/background.js` verifies releases and checks URLs and phone numbers locally.
- `backend/supabase/migrations/202611150007_feed_releases.sql` tracks signing keys and release lifecycle; `feed-snapshot` serves only the current non-expired signed snapshot.

## Local setup

1. Install Node.js 22.12 or newer, the Supabase CLI, and Docker for local Supabase services.
2. Copy `frontend/.env.example` to `frontend/.env.local`, then set the local Supabase URL and publishable key. Never place a Supabase secret/service-role key in the frontend or extension.
3. From `backend`, run `supabase start`, then `supabase db reset`. Configure Edge Function secrets with `INDICATOR_ENCRYPTION_KEY`, `INDICATOR_HMAC_KEY`, `INDICATOR_HMAC_KEY_VERSION`, `EVIDENCE_UPLOAD_HMAC_KEY`, and `ALLOWED_ORIGINS`. The encryption, HMAC, and evidence ticket keys must be independent random 32-byte keys encoded as base64. Keep them in the Supabase secret store. `upload-evidence` and `moderator-review` require the Supabase service-role key in their Edge Function runtime for private storage operations; it is server-side only and must never be exposed to a browser.
4. From `frontend`, run `npm install` and `npm run dev`.
5. Before loading `extension/` as an unpacked extension, set its feed URL, host permission, and Ed25519 verification public key in `config.js` and `manifest.json`. The example values intentionally cannot verify a feed.

The public Edge Function entrypoints under `backend/supabase/functions/` re-export source from the requested `backend/functions/` tree so the Supabase CLI can serve and deploy them without duplicating implementation.

## Security and operating boundaries

- A report is an allegation. Its candidate indicators start in `proposed` state with zero confidence and are never published automatically.
- Sensitive report, indicator, assignment, case, consent, and audit records live in the non-exposed `private` schema. Browser users receive only narrow authenticated RPC responses.
- Role grants are created by trusted database operations. Users cannot edit their own role assignments, report status, confidence, or publication state.
- Citizens must sign in for this starter intake. Anonymous intake needs a reviewed anti-abuse design before it is enabled.
- Moderator triage is limited to active report assignments. One moderator records source-backed verification, then a distinct senior reviewer or platform admin must independently approve publication; approval only makes the indicator eligible for a separately controlled feed release.
- Analyst case briefs are sanitized. Claims become time-limited assignments under per-case and per-analyst locks, and findings require source links and mentor review before contribution points are awarded.
- Team rooms and messages are available only to authorized staff roles and active case assignees. Message rows omit sender account IDs and direct client writes are disabled.
- Analyst tooling is limited to explicitly scoped passive research. No intrusion, account access, suspect contact, doxxing, or private-record collection is provided.
- The feed endpoint returns `503` until a reviewed release compiler and managed Ed25519 signing key are deployed. The extension fails closed on invalid or expired snapshots and checks user-entered URLs locally; this starter does not inspect all browsing traffic.
- Evidence intake uses a five-minute user-bound upload ticket and writes to a private quarantine bucket. Files are signature-checked and hashed server-side, but remain pending and inaccessible until a malware scanning, authorized review/download, and retention cleanup workflow is deployed. Moderator preview links are signed for 60 seconds only after a clean scan and quarantine release.

Before any live launch, complete the legal, privacy, threat-model, hosting-region, key-management, abuse-control, RLS, independent review, recovery, and institutional authorization decisions in the supplied specification.
