# Chat Grounding Design

## Goal

Make `/api/ai/chat` answer workspace questions from the records the user is asking about: meetings, people, tasks, summaries, and transcript snippets. Broad calendar questions such as "How many meetings did we have this week?" must answer deterministically with meeting titles, links, dates, and attendees instead of returning a bare count or model guess.

## Current Behavior

The chat route already has two paths:

- Meeting-scoped chat loads one meeting by id and sends its transcript or summary to `answerMeetingQuestion`.
- Workspace chat either uses `searchWorkspaceContext` or, for weekly meeting count questions, calls the internal `get_calendar_agenda` MCP tool.

The recent regression fix made meeting-count answers deterministic, but the deterministic answer only returns a count. Calendar agenda context also only includes attendee counts, not attendee names or links. Retrieval context for open-ended questions includes meetings, tasks, and people, but it does not expose route links and does not make broad meeting list questions deterministic.

## Selected Approach

Use the existing architecture and improve the structured context at the route boundary.

1. Keep `planWorkspaceChatQuestion` as the router for operational calendar questions, but broaden the "this week meetings" intent to cover "list/show/what meetings" as well as "how many".
2. Enrich `get_calendar_agenda` data and `runInternalChatTool` context with meeting links and attendee labels.
3. Replace the current count-only operational fallback with a deterministic agenda answer that includes the count, meeting title, date, link, attendee list, and client-meeting marker.
4. Enrich retrieval context lines for general meeting/person/task questions with meeting links, task source meeting links, and person task counts when available, while continuing to let `answerWorkspaceQuestion` synthesize transcript/summary answers from retrieved context.
5. Keep anti-hallucination filters unchanged: sources and actions are still limited to ids actually present in the retrieved context.

## Trade-Offs

An all-LLM approach would be simpler to wire but already failed in production by confidently saying no meetings existed. A fully separate chat tool registry would be more extensible, but it is too much surface area for this bug. The selected approach keeps deterministic behavior where the answer is a structured list/count, and keeps retrieval-plus-LLM behavior where synthesis over transcripts, summaries, people, and tasks is useful.

## Data Flow

- User asks a calendar-wide question.
- `planWorkspaceChatQuestion` routes it to `get_calendar_agenda` with the current ISO week range.
- `runInternalChatTool` renders rows like `MEETING <id> | <title> | <date> | link=/meetings/<id> | attendees=<names> | attendeeCount=<n> | clientMeeting=<bool>`.
- The route builds a deterministic answer for `weekly_meetings_overview` and `meeting_count_this_week`.

For open-ended questions, `searchWorkspaceContext` retrieves matching meetings, snippets, tasks, and people. The route renders richer context blocks, including links, summaries, transcript snippets, task status/due/assignee, and people metadata. The general chat flow answers from those blocks and the route filters output ids.

## Testing

Add regression tests before implementation:

- Planner routes "What meetings did we have this week?" to the calendar agenda tool.
- Internal chat tool context includes attendee labels and meeting links.
- Route returns a deterministic weekly meeting overview containing titles, links, and attendees without relying on the model.
- Route renders richer retrieval context for meeting/person/task questions.
- MCP calendar agenda returns attendee details in addition to counts.

## Non-Goals

- No new dependencies.
- No UI redesign.
- No new database collections.
- No broad refactor of chat flows or retrieval ranking.
