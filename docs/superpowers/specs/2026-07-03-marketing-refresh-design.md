# Taskwise Marketing Refresh Design

## Goal

Refresh the public homepage so it clearly showcases the new Taskwise platform story from this branch:

- Meeting ingestion from Fathom, Fireflies, and Grain
- Source-grounded chat over meetings, tasks, and people/client data
- AI task cleanup
- Deterministic prioritization
- Planning workspace
- Slack reminders
- MCP and advanced operator capabilities

The homepage should feel polished, bold, and product-led. It should impress first-time visitors without hiding the real product.

## Scope

### In scope

- Redesign the homepage at `src/app/page.tsx`
- Add public marketing pages for:
  - `/features`
  - `/integrations`
  - `/mcp`
- Reuse existing brand and motion language where it already helps, but elevate the presentation
- Make the homepage a high-level launch page, not a dense feature dump
- Ensure the new pages accurately reflect what is already in this branch

### Out of scope

- No changes to authenticated app workflows
- No changes to backend behavior
- No speculative claims about unsupported integrations
- No redesign of login/signup flows beyond keeping links consistent

## Product Narrative

Taskwise should read as an operating system for meeting-driven work:

1. Capture meetings and notes from Fathom, Fireflies, Grain, or paste input.
2. Ask Taskwise questions over meeting/task/person/client context.
3. Clean up noisy tasks into reviewed, trustworthy work.
4. Prioritize what matters next.
5. Plan the week and keep follow-through alive with reminders and automation.
6. Expose advanced operator surfaces like MCP, workflow delivery, and integration management.

The homepage should tell this story in that order.

## Information Architecture

### Homepage

The homepage should be reorganized into these sections:

1. Hero
2. Product flow
3. Core capabilities
4. Integrations layer
5. Planning and execution layer
6. Operator layer
7. Final CTA

### Supporting Pages

#### `/features`

Purpose: explain the product capabilities in more detail without crowding the homepage.

Sections:

- AI chat over workspace context
- Cleanup tasks
- Deterministic prioritization
- Planning workspace
- Calendar and people/client surfaces
- Slack reminders

#### `/integrations`

Purpose: make integrations feel like a first-class platform surface.

Sections:

- Fathom
- Fireflies
- Grain
- Slack
- Google Workspace
- Trello
- Manual paste / sample data

Each integration card should explain:

- What it connects
- What kind of data it contributes
- How it supports the core workflow

#### `/mcp`

Purpose: explain the operator/runtime layer in plain language.

Sections:

- What MCP is for in Taskwise
- Read tools
- Write tools
- Auth and auditability
- Safe operator use cases

## Visual Direction

The page should feel like a premium launch site, not a dashboard screenshot dump.

Design principles:

- Dark, cinematic background with controlled gradients
- Large hero headline and tight supporting copy
- Fewer but larger content blocks
- Strong hierarchy between “core product” and “advanced platform”
- Motion that supports the story, not decoration for its own sake
- Integrations and MCP should feel like power features, not afterthoughts

## Homepage Content Plan

### Hero

Headline direction:

- Meeting work, finally organized end to end
- or
- Turn meetings into prioritized, reviewed execution

Subheadline should include:

- Fathom, Fireflies, Grain, or pasted notes
- AI chat over meetings/tasks/people/clients
- cleanup, prioritization, planning, and reminders

### Product Flow

Show the core loop in four stages:

- Capture
- Understand
- Review
- Execute

This is where the user should see the branch’s major features mapped into a simple story.

### Core Capabilities

Must include:

- General AI chat with grounded sources and suggested actions
- AI task cleanup with reversible review states
- Deterministic task prioritization
- Planning workspace triage
- Calendar surfaces
- People versus client classification

### Integrations Layer

Must explicitly mention:

- Fathom
- Fireflies
- Grain
- Slack reminders and follow-through
- Google Workspace
- Trello
- MCP access for operator workflows

### Operator Layer

Must explicitly mention:

- MCP keys and auth
- audit logs
- workflow delivery/replay
- integration health and controls
- advanced settings without making the public page feel admin-only

## Page Design Notes

### `/features`

The features page should be more explanatory than the homepage.

It should break the product into readable blocks:

- Ask Taskwise
- Clean up task noise
- Prioritize what matters
- Plan the week
- Keep reminders alive

Each block should be rooted in actual UI or behavior from this branch.

### `/integrations`

The integrations page should:

- Present Fathom, Fireflies, and Grain as equal, first-class note-taker options
- Show Slack as the reminder and delivery channel
- Show Google and Trello as external workflow surfaces
- Make clear that “MCP” is the advanced operator surface, not a normal end-user integration

### `/mcp`

The MCP page should:

- Explain the value in plain English
- Show the read/write split
- Emphasize workspace scoping and auditability
- Avoid sounding like a developer-only novelty page

## Content Accuracy Rules

The copy must stay aligned with implemented functionality:

- Do not imply a supported integration if it is only planned
- Do not imply fully automated agent autonomy beyond what the app already does
- Do not describe MCP write tools as unrestricted
- Do not describe Slack reminders as chat-sent messages; they are scheduled reminders with persistence and state

## Implementation Constraints

- Reuse existing components where possible
- Keep the homepage visually rich but not overcrowded
- Keep marketing pages fast and responsive
- Preserve existing auth links and routes
- Ensure the new pages work well on desktop and mobile

## Acceptance Criteria

The refresh is complete when:

- The homepage clearly showcases all major branch features
- Fireflies and Grain are visible as supported note-takers
- Task cleanup, prioritization, planning, Slack reminders, and chat are all represented
- A visitor can navigate to distinct `/features`, `/integrations`, and `/mcp` pages
- The site feels like a cohesive public launch, not a patchwork of feature cards
- All content claims map to actual behavior in the branch

## Open Questions Resolved

- The homepage should be public marketing, not docs.
- Supporting pages are worth adding because the feature set is now broad enough that the homepage alone would become cluttered.
- MCP should be presented as a power feature with its own page, not buried inside integrations.

