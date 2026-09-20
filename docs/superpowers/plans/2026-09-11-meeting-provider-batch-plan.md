# Meeting Provider Batch — tl;dv, Otter.ai, MeetGeek, Read AI

Date: 2026-09-11
Branch: `feat/meeting-providers-batch-sep2026`
Base: `main` (`abd700f23dff0cd2544e4007b63bfb9a289a5988`)

## Goal

Add four useful meeting-source integrations without forking Taskwise's existing meeting ingestion rail. tl;dv, Otter.ai, and MeetGeek receive API-key based connect + manual backfill sync + webhook support. Read AI is implemented webhook-first because its September 2026 public REST API still uses short-lived OAuth 2.1 access tokens with rotating refresh tokens and explicitly does not offer static API keys.

All providers normalize into `NormalizedProviderMeeting` and then use the existing dedupe -> shared task extraction -> meeting/planning docs -> domain events -> people/task/workflow/Slack pipeline.

## Design decision

### Rejected A — four bespoke integrations

Would create provider-specific routes, storage, sync jobs and UI. Fast to prototype but duplicates proven infrastructure and makes future providers expensive.

### Rejected B — webhook-only for every provider

Simpler, but throws away useful backfill/manual sync for tl;dv, Otter and MeetGeek, all of which expose stable API credentials and list/detail APIs.

### Chosen C — shared adapter registry + explicit capabilities

Extend the current provider contract with small capability metadata. API-key providers retain the existing route shape. Read AI can create an active webhook connection without pretending it has a durable API key, and the UI disables manual sync when a provider has no durable fetch/list credentials.

## External contracts verified against current official docs

### tl;dv

- API base: `https://pasta.tldv.io/v1alpha1`.
- Auth: `x-api-key`.
- List: `GET /meetings`, detail: `GET /meetings/{id}`, transcript: `GET /meetings/{id}/transcript`, notes: `GET /meetings/{id}/notes`.
- Webhook events include `MeetingReady` and `TranscriptReady`.
- Current API is v1alpha1, so parsing must remain defensive.

### Otter.ai

- API base: `https://api.otter.ai/v1`.
- Auth: `Authorization: Bearer <API_KEY>`.
- Public API is Enterprise-only.
- List: `GET /conversations`, detail: `GET /conversations/{id}?include=...`.
- Workspace webhooks emit completed conversations and include transcript/summary/action-item data.

### MeetGeek

- API base: `https://api.meetgeek.ai/v1` (regional alternatives exist).
- Auth: Bearer API key.
- List: `GET /meetings`, detail: `GET /meetings/{id}`, transcript: `GET /meetings/{id}/transcript`.
- Meeting-complete webhooks are supported. API keys are region-specific.

### Read AI

- Public API is open beta and uses OAuth 2.1; static API keys are not yet supported.
- Access tokens expire after roughly 10 minutes and refresh tokens rotate.
- Webhooks can send full meeting reports including transcript, participants, summary, action items and report URL.
- New webhooks can be verified with HMAC using `X-Read-Signature` and the webhook signing key.
- This release therefore supports inbound Read AI webhooks and intentionally does not expose a fake/manual backfill sync button.

## Implementation checkpoints

### P0 — tests first

- [ ] Extend registry tests to require `tldv`, `otter`, `meetgeek`, `read`.
- [ ] Add provider adapter tests for credential validation, list/detail normalization and webhook parsing.
- [ ] Add Read AI tests for inline `meeting_end` normalization and `X-Read-Signature` verification.
- [ ] Extend generic connection-route tests to prove webhook-only providers can connect without `apiKey` while API-key providers still require it.
- [ ] Extend integration-card tests for provider copy and capability-driven sync visibility.

Expected RED state: new tests fail because provider IDs/adapters/capabilities do not exist yet.

### P1 — provider capability contract

Files:
- `src/lib/meeting-providers/types.ts`
- `src/lib/meeting-providers/index.ts`
- `src/lib/meeting-connections.ts`
- `src/app/api/integrations/[provider]/route.ts`
- `src/app/api/integrations/[provider]/sync/route.ts`

Tasks:
- [ ] Add the four provider IDs.
- [ ] Add adapter capability metadata: connection mode, sync support, webhook secret support/setup guidance.
- [ ] Allow `apiKey: null` in stored generic connections.
- [ ] Keep secret serialization redacted by default.
- [ ] Keep API-key validation mandatory for API-key providers.
- [ ] Allow webhook-only connection creation without an API key.
- [ ] Return capabilities from GET/POST connection responses.
- [ ] Return a clear 422 from manual sync for providers that do not support it.

### P2 — tl;dv adapter

Files:
- `src/lib/meeting-providers/tldv.ts`
- `src/lib/meeting-providers/tldv.test.ts`

Tasks:
- [ ] Validate API key using a low-cost authenticated request.
- [ ] List meetings with defensive pagination and optional local `since` filtering.
- [ ] Fetch detail + transcript + notes and normalize participants/timestamps/summary.
- [ ] Parse `MeetingReady` / `TranscriptReady` into meeting references.
- [ ] Never expose the API key in logs/errors.

### P3 — Otter.ai adapter

Files:
- `src/lib/meeting-providers/otter.ts`
- `src/lib/meeting-providers/otter.test.ts`

Tasks:
- [ ] Validate against `/workspace` with a fallback lightweight conversation list if appropriate.
- [ ] List conversations using cursor pagination.
- [ ] Fetch conversation with transcript/action-items relationships.
- [ ] Normalize owner/calendar guests/transcript/summary/action items.
- [ ] Parse `conversation.completed` webhook payloads; ingest inline when the payload contains a complete transcript, otherwise fetch by id.
- [ ] Surface Enterprise-only requirement in UI copy.

### P4 — MeetGeek adapter

Files:
- `src/lib/meeting-providers/meetgeek.ts`
- `src/lib/meeting-providers/meetgeek.test.ts`

Tasks:
- [ ] Validate API key through `/meetings?limit=1`.
- [ ] List meetings with cursor pagination.
- [ ] Fetch detail and all transcript pages (bounded).
- [ ] Normalize host/participant emails, timing, transcript and share/join metadata.
- [ ] Parse meeting-complete webhook payloads defensively.
- [ ] Document default EU endpoint and region-specific key caveat.

### P5 — Read AI webhook-first adapter

Files:
- `src/lib/meeting-providers/read.ts`
- `src/lib/meeting-providers/read.test.ts`

Tasks:
- [ ] Configure adapter as `webhook-only`, no manual sync.
- [ ] Verify `X-Read-Signature` HMAC-SHA256 when a signing key is stored; preserve current no-secret compatibility behavior.
- [ ] Ignore `meeting_start`; normalize `meeting_end` inline payloads.
- [ ] Normalize transcript turns using timestamps relative to meeting start.
- [ ] Normalize owner/participants/summary/action items/report URL.
- [ ] Avoid REST token storage until Taskwise has a durable OAuth/refresh-token model.

### P6 — ingestion + UI

Files:
- `src/lib/meeting-providers/ingest-pipeline.ts`
- `src/components/dashboard/settings/MeetingProviderIntegrationCard.tsx`
- `src/components/dashboard/settings/MeetingProviderIntegrationCard.test.tsx`
- `src/components/dashboard/settings/SettingsPageContent.tsx`
- `src/app/integrations/page.tsx`

Tasks:
- [ ] Add provider-specific default titles.
- [ ] Add all four provider cards to Settings.
- [ ] Make API-key input conditional on connection mode.
- [ ] Make Sync button conditional on adapter capability.
- [ ] Add exact setup guidance for each provider and honest availability labels (Otter Enterprise, Read webhook-first beta).
- [ ] Update public integrations page to distinguish connected/available provider paths without claiming credential/live verification.

### P7 — verification and release

- [ ] Draft PR against `main` to exercise CI.
- [ ] RED verification: capture expected provider-test failures before production implementation.
- [ ] Implement minimal production code to satisfy tests.
- [ ] Run/observe fresh CI: install, lint, typecheck, build, Jest, route smoke.
- [ ] Verify Vercel preview success.
- [ ] Review diff for secrets, tenant/workspace scoping, unbounded pagination, unsafe webhook verification and false marketing claims.
- [ ] Mark PR ready and squash-merge to `main` only when all release gates are green.
- [ ] Verify `refs/heads/main` equals the returned merge SHA.

## Security / reliability rules

- Provider secrets remain server-only and redacted by serializers.
- Never log API keys, webhook secrets or transcript bodies.
- Webhook routing token must resolve to the matching active provider connection.
- HMAC comparisons use timing-safe equality.
- Network responses are parsed defensively; malformed provider payloads become ignore/null, not crashes.
- List/transcript pagination is bounded to prevent runaway jobs.
- Provider API errors are actionable but do not echo credentials.
- All ingestion continues through the shared idempotent provider pipeline.

## Live-verification boundary

Unit/integration tests use mocked provider responses. This release can be code/contract verified in CI, but actual provider account behavior remains `VERIFY-ON-FIRST-LIVE-RUN` until real credentials/webhooks are exercised. UI and docs must say so implicitly by avoiding "verified/live" claims.