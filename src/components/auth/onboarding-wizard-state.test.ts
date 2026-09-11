import {
  getOnboardingDestination,
  getOnboardingDestinationLabel,
  normalizeOnboardingGoal,
  normalizeOnboardingStep,
} from "@/components/auth/onboarding-wizard-state";

describe("onboarding wizard state", () => {
  it("resumes only valid persisted steps", () => {
    expect(normalizeOnboardingStep("3")).toBe(3);
    expect(normalizeOnboardingStep("0")).toBe(1);
    expect(normalizeOnboardingStep("99")).toBe(5);
    expect(normalizeOnboardingStep("wat")).toBe(1);
    expect(normalizeOnboardingStep(null)).toBe(1);
  });

  it("falls back to follow-up for unknown goals", () => {
    expect(normalizeOnboardingGoal("search")).toBe("search");
    expect(normalizeOnboardingGoal("unknown")).toBe("follow_up");
    expect(normalizeOnboardingGoal(null)).toBe("follow_up");
  });

  it("routes the first success to the surface that matches the selected goal", () => {
    expect(getOnboardingDestination("capture")).toBe("/meetings");
    expect(getOnboardingDestination("follow_up")).toBe("/meetings");
    expect(getOnboardingDestination("search")).toBe("/chat");
    expect(getOnboardingDestination("automate")).toBe("/automations");
    expect(getOnboardingDestinationLabel("automate")).toBe("Open Automations");
  });
});
