import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MeetingAgendaSection,
  MeetingCompletionSuggestionsSection,
  MeetingLinkedChatSection,
  MeetingRelatedClientsSection,
  MeetingSourceSection,
  MeetingTranscriptViewer,
  normalizeAgendaItems,
} from "@/components/dashboard/meetings/MeetingDetailSections";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

describe("normalizeAgendaItems", () => {
  it("splits a string agenda into items and strips bullets/numbering", () => {
    expect(
      normalizeAgendaItems("- Kickoff recap\n2) Pricing discussion\n\n* Next steps")
    ).toEqual([
      { title: "Kickoff recap" },
      { title: "Pricing discussion" },
      { title: "Next steps" },
    ]);
  });

  it("accepts the canonical { id, title, notes, order } sections and sorts by order", () => {
    expect(
      normalizeAgendaItems([
        { id: "b", title: "Pricing", notes: "Discuss tiers", order: 1 },
        { id: "a", title: "Intro", notes: "", order: 0 },
      ])
    ).toEqual([
      { title: "Intro", notes: undefined },
      { title: "Pricing", notes: "Discuss tiers" },
    ]);
  });

  it("accepts string arrays and legacy { text } arrays", () => {
    expect(normalizeAgendaItems(["One", "  Two "])).toEqual([
      { title: "One", notes: undefined },
      { title: "Two", notes: undefined },
    ]);
    expect(normalizeAgendaItems([{ text: "One" }, { text: " " }, {}])).toEqual([
      { title: "One", notes: undefined },
    ]);
  });

  it("returns an empty list for unsupported shapes", () => {
    expect(normalizeAgendaItems(undefined)).toEqual([]);
    expect(normalizeAgendaItems(42)).toEqual([]);
  });
});

describe("MeetingAgendaSection", () => {
  it("renders agenda items read-only", () => {
    const markup = renderToStaticMarkup(
      <MeetingAgendaSection agenda={"- Kickoff recap\n- Pricing discussion"} />
    );
    expect(markup).toContain("Agenda");
    expect(markup).toContain("Kickoff recap");
    expect(markup).toContain("Pricing discussion");
  });

  it("renders canonical agenda sections with notes", () => {
    const markup = renderToStaticMarkup(
      <MeetingAgendaSection
        agenda={[
          { id: "a", title: "Intro", notes: "Warm-up", order: 0 },
          { id: "b", title: "Pricing", notes: "Discuss tiers", order: 1 },
        ]}
      />
    );
    expect(markup).toContain("Intro");
    expect(markup).toContain("Warm-up");
    expect(markup).toContain("Pricing");
    expect(markup).toContain("Discuss tiers");
  });

  it("renders nothing when the meeting has no agenda", () => {
    expect(renderToStaticMarkup(<MeetingAgendaSection agenda={null} />)).toBe("");
  });
});

describe("MeetingCompletionSuggestionsSection", () => {
  const suggestion = {
    taskId: "task-1",
    title: "Send updated proposal",
    assigneeName: "Ana",
    reason: "Mentioned as already sent",
    evidence: [
      {
        snippet: "I already sent the updated proposal to legal yesterday.",
        speaker: "Ana",
        timestamp: "02:05",
      },
    ],
  };

  it("renders the suggestion with evidence and accept/dismiss actions", () => {
    const markup = renderToStaticMarkup(
      <MeetingCompletionSuggestionsSection
        suggestions={[suggestion]}
        onAccept={() => {}}
        onDismiss={() => {}}
        onJumpToTranscript={() => {}}
      />
    );
    expect(markup).toContain("Completion suggestions");
    expect(markup).toContain("Send updated proposal");
    expect(markup).toContain("Owner: Ana");
    expect(markup).toContain(
      "I already sent the updated proposal to legal yesterday."
    );
    expect(markup).toContain("[02:05]");
    expect(markup).toContain("Accept");
    expect(markup).toContain("Dismiss");
    expect(markup).toContain("Jump to transcript");
  });

  it("renders nothing when there are no suggestions", () => {
    expect(
      renderToStaticMarkup(
        <MeetingCompletionSuggestionsSection
          suggestions={[]}
          onAccept={() => {}}
          onDismiss={() => {}}
        />
      )
    ).toBe("");
  });
});

describe("MeetingLinkedChatSection", () => {
  it("renders linked chat sessions with an open action", () => {
    const markup = renderToStaticMarkup(
      <MeetingLinkedChatSection
        sessions={[{ id: "s1", title: 'Chat about "Kickoff"' }]}
        onOpenSession={() => {}}
      />
    );
    expect(markup).toContain("Linked chats");
    expect(markup).toContain("Chat about");
    expect(markup).toContain("Open chat");
  });
});

describe("MeetingRelatedClientsSection", () => {
  it("renders client names with company and a profile link", () => {
    const markup = renderToStaticMarkup(
      <MeetingRelatedClientsSection
        clients={[{ id: "p1", name: "Stefan Novak", company: "Acme Corp" }]}
      />
    );
    expect(markup).toContain("Related clients");
    expect(markup).toContain("Stefan Novak");
    expect(markup).toContain("Acme Corp");
    expect(markup).toContain("/people/p1");
  });

  it("renders nothing without clients", () => {
    expect(
      renderToStaticMarkup(<MeetingRelatedClientsSection clients={[]} />)
    ).toBe("");
  });
});

describe("MeetingSourceSection", () => {
  it("renders a friendly label for the ingest source", () => {
    const markup = renderToStaticMarkup(
      <MeetingSourceSection ingestSource="fathom" />
    );
    expect(markup).toContain("Source");
    expect(markup).toContain("Fathom");
  });

  it("renders nothing when the source is unknown", () => {
    expect(
      renderToStaticMarkup(<MeetingSourceSection ingestSource={null} />)
    ).toBe("");
  });
});

describe("MeetingTranscriptViewer", () => {
  const lines = [
    "[00:12] Ana: Welcome everyone.",
    "[01:30] Stefan: The pricing feels too high.",
  ];

  it("renders each line with a stable jump-target id", () => {
    const markup = renderToStaticMarkup(
      <MeetingTranscriptViewer lines={lines} highlightIndex={null} />
    );
    expect(markup).toContain('id="meeting-transcript-line-0"');
    expect(markup).toContain('id="meeting-transcript-line-1"');
    expect(markup).toContain("The pricing feels too high.");
    expect(markup).not.toContain("ring-primary/40");
  });

  it("highlights the requested line", () => {
    const markup = renderToStaticMarkup(
      <MeetingTranscriptViewer lines={lines} highlightIndex={1} />
    );
    expect(markup).toContain("ring-primary/40");
  });

  it("shows an empty state without a transcript", () => {
    const markup = renderToStaticMarkup(
      <MeetingTranscriptViewer lines={[]} highlightIndex={null} />
    );
    expect(markup).toContain("No transcript is attached");
  });
});
