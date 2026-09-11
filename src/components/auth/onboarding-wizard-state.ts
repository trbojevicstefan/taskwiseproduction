export type OnboardingGoal = "capture" | "follow_up" | "search" | "automate";

export const ONBOARDING_TOTAL_STEPS = 5;

export const normalizeOnboardingStep = (
  rawValue: string | null | undefined,
  totalSteps = ONBOARDING_TOTAL_STEPS
): number => {
  if (!rawValue) return 1;
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), totalSteps);
};

export const normalizeOnboardingGoal = (
  rawValue: string | null | undefined
): OnboardingGoal => {
  if (
    rawValue === "capture" ||
    rawValue === "follow_up" ||
    rawValue === "search" ||
    rawValue === "automate"
  ) {
    return rawValue;
  }
  return "follow_up";
};

export const getOnboardingDestination = (
  goal: OnboardingGoal
): "/meetings" | "/chat" | "/automations" => {
  if (goal === "search") return "/chat";
  if (goal === "automate") return "/automations";
  return "/meetings";
};

export const getOnboardingDestinationLabel = (goal: OnboardingGoal): string => {
  if (goal === "search") return "Open Chat";
  if (goal === "automate") return "Open Automations";
  return "Open Meetings";
};
