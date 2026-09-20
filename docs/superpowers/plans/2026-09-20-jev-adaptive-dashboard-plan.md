# Jev Adaptive Dashboard Plan — Context-aware Taskwise UI

Date: 2026-09-20
Branch: `feat/jev-adaptive-dashboard-sep2026`

## Goal

Use TypeSafe AI Jev as a fast, typed decision layer for Taskwise so the Planning dashboard can choose the most useful next surface from recent meetings, important tasks, and people/follow-up context without allowing a model to generate arbitrary UI or mutate work.

The feature must preserve Taskwise's existing visual system and deterministic task priority/review rules.

## Research findings

Jev/System One is designed for fast structured judgments over supplied state rather than prose generation. It supports three composable primitives:

- Choice — select one option and return probabilities + confidence.
- Score — choose a position on a defined scale and return probabilities + confidence.
- Noul — return a yes probability between 0 and 1.

Multiple independent questions over the same state should be sent together and composed in application code. Confidence should gate behavior: uncertain judgments should not trigger high-attention UI.

## Approaches considered

### A. Let Jev generate the dashboard
Rejected. Jev is not a generative UI/string model, and arbitrary generated components would be unsafe, inconsistent, and impossible to QA.

### B. Client-side Jev calls
Rejected. This would expose the API key, weaken workspace boundaries, and send data directly from the browser.

### C. Server-side typed decision layer — chosen
Build a compact dashboard state on the server, ask Jev several atomic questions in one request, validate the typed response, then map it to an allowlisted Taskwise UI intervention. If Jev is unavailable or uncertain, use deterministic fallback logic.

## Product behavior

### Eligible focus modes

- `connect_meeting_source` — no useful meeting history yet.
- `review_meeting` — recent meetings produced suggested work that needs review.
- `prioritize_tasks` — urgent/high-priority open work needs focus.
- `prepare_meeting` — upcoming/recent meeting context suggests preparation.
- `follow_up_people` — repeated attendee/client context suggests follow-up.
- `meeting_digest` — high recent meeting volume merits a digest.
- `quiet` — no interruption.

### Surface policy

Jev does not choose raw React/UI. Application code maps typed answers to:
- `none`
- `inline`
- `popover`
- `modal`

A modal requires both sufficient evidence and high confidence. Medium confidence can only produce inline/popover guidance. Low confidence falls back to deterministic logic or no interruption.

Only one interruptive surface may be shown for a decision. Dismissals are stored client-side by stable `decisionKey` so the same intervention is not repeated every visit.

### Meeting-volume behavior

- 0 meetings: setup/connect guidance; no fake digest.
- 1–2 recent meetings: review-first intervention when extracted work exists.
- 3–5 recent meetings: focus on top work / follow-up.
- 6+ recent meetings: eligible for a meeting-load digest, still subject to task/review urgency.

These ranges are eligibility rules, not hard model outputs. Jev chooses among the eligible useful interventions.

## Data minimization

Send only a compact state:
- counts for recent meetings and review work;
- up to 6 recent meeting titles, short summaries, dates, and attendee display names;
- up to 8 open tasks with title, priority score/label/reason, due date, assignee display name, and status;
- up to 8 recent/high-frequency people summaries derived from recent attendees/task assignees.

Do not send full transcripts, emails, API tokens, recording URLs, auth/session data, or arbitrary database documents.

## Jev request

One `POST https://api.typesafe.ai/v1/systemone` request using `TYPESAFE_API_KEY` and `TYPESAFE_MODEL || "jev-latest"`.

Questions are atomic and evaluated in parallel:

1. `focus` Choice — which single intervention is most useful.
2. `attention` Score — no interruption / inline / popover / modal-worthy.
3. `meeting_digest_useful` Noul.
4. `task_focus_useful` Noul.
5. `people_followup_useful` Noul.

The code validates the response and applies confidence thresholds before selecting a surface.

## Implementation checkpoints

### CP1 — Decision model + tests
- [x] RED: add tests for deterministic fallback, Jev request shape, confidence gating, and response validation.
- [x] Implement `src/lib/jev-dashboard.ts`.
- [x] Verify focused tests GREEN.

### CP2 — Workspace-scoped dashboard state + route
- [x] RED: route tests for unauthorized access, state minimization, and fallback behavior.
- [x] Add `GET /api/dashboard/adaptive`.
- [x] Query active workspace only using existing workspace-scope helpers.
- [x] Query recent meetings/open tasks with narrow projections and hard caps.
- [x] Derive people signals without sending email addresses.
- [x] Add route to smoke-test coverage if the repository convention requires explicit registration.
- [x] Verify route tests GREEN.

### CP3 — Adaptive dashboard UI
- [x] RED: component tests for modal/popover/inline/quiet and dismissal behavior.
- [x] Add `AdaptiveDashboardLayer` using existing Radix/shadcn Dialog, Popover, Card, Badge and Button primitives.
- [x] Mount it on `/planning` without changing the existing Planning layout/system.
- [x] Link interventions to existing routes: Review, Meetings, Planning agendas, People, Settings integrations.
- [x] Never auto-mutate tasks/meetings/people from a Jev decision.
- [x] Verify component/page tests GREEN.

### CP4 — Release verification
- [x] Run focused tests.
- [x] Run full Jest suite.
- [x] Run lint.
- [x] Run typecheck.
- [x] Run production build.
- [x] Run route smoke tests.
- [x] Verify exact-head GitHub/Vercel status.
- [x] Create PR and merge only when release gates are green.

## Environment

Optional production variables:

```
TYPESAFE_API_KEY=...
TYPESAFE_MODEL=jev-latest
```

If the API key is absent or Jev fails/times out, the endpoint must remain functional using the deterministic fallback. No user-facing error modal should be shown merely because Jev is unavailable.

## Acceptance criteria

- Dashboard behavior changes meaningfully with recent meeting/task/people state.
- No arbitrary generated UI or prose is trusted.
- No full transcripts or emails are sent to TypeSafe.
- Workspace boundaries are enforced server-side.
- A low-confidence Jev answer cannot trigger a modal.
- Repeated visits do not show the same dismissed interruption.
- Taskwise remains fully usable without a TypeSafe API key.
