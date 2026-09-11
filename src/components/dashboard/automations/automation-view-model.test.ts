import {
  buildAutomationHealthSummary,
  getAutomationHealthState,
  getAutomationTemplateDraft,
} from "@/components/dashboard/automations/automation-view-model";

describe("automation view model", () => {
  it("counts active, paused, and needs-attention workflows", () => {
    expect(
      buildAutomationHealthSummary([
        { enabled: true, autoDisabledAt: null },
        { enabled: false, autoDisabledAt: null },
        { enabled: false, autoDisabledAt: "2026-09-11T09:00:00.000Z" },
      ])
    ).toEqual({ total: 3, active: 1, paused: 1, needsAttention: 1 });
  });

  it("prioritizes auto-disabled workflows as needs attention", () => {
    expect(
      getAutomationHealthState({
        enabled: false,
        autoDisabledAt: "2026-09-11T09:00:00.000Z",
      })
    ).toBe("needs_attention");
  });

  it("builds a useful draft from a recipe", () => {
    expect(getAutomationTemplateDraft("meeting-webhook")).toEqual({
      name: "Meeting handoff",
      description: "Send each newly processed meeting to another system.",
      trigger: "meeting.ingested",
    });
  });
});