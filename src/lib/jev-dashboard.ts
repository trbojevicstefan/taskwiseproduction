export type AdaptiveDashboardFocus =
  | "connect_meeting_source"
  | "review_meeting"
  | "prioritize_tasks"
  | "prepare_meeting"
  | "follow_up_people"
  | "meeting_digest"
  | "quiet";

export type AdaptiveDashboardSurface = "none" | "inline" | "popover" | "modal";

export interface AdaptiveDashboardMeeting {
  id: string;
  title: string;
  summary: string;
  occurredAt: string | null;
  attendeeNames: string[];
  extractedTaskCount: number;
  suggestedTaskCount: number;
}

export interface AdaptiveDashboardTask {
  id: string;
  title: string;
  priorityScore: number | null;
  priorityLabel: string | null;
  priorityReason: string | null;
  dueAt: string | null;
  assigneeName: string | null;
  status: string | null;
}

export interface AdaptiveDashboardPersonSignal {
  id: string;
  name: string;
  recentMeetingCount: number;
  openTaskCount: number;
  client: boolean;
}

export interface AdaptiveDashboardSnapshot {
  recentMeetingCount: number;
  meetingsNeedingReview: number;
  upcomingMeetingCount: number;
  urgentTaskCount: number;
  highPriorityTaskCount: number;
  openTaskCount: number;
  peopleFollowupCount: number;
  recentMeetings: AdaptiveDashboardMeeting[];
  topTasks: AdaptiveDashboardTask[];
  peopleSignals: AdaptiveDashboardPersonSignal[];
}

export interface AdaptiveDashboardDecision {
  source: "jev" | "fallback";
  focus: AdaptiveDashboardFocus;
  surface: AdaptiveDashboardSurface;
  confidence: number;
  decisionKey: string;
  eyebrow: string;
  title: string;
  description: string;
  primaryAction: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
}

type EvaluateOptions = {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
};

const FOCUS_VALUES: AdaptiveDashboardFocus[] = [
  "connect_meeting_source",
  "review_meeting",
  "prioritize_tasks",
  "prepare_meeting",
  "follow_up_people",
  "meeting_digest",
  "quiet",
];

const COPY: Record<
  AdaptiveDashboardFocus,
  Omit<AdaptiveDashboardDecision, "source" | "focus" | "surface" | "confidence" | "decisionKey">
> = {
  connect_meeting_source: {
    eyebrow: "Build your meeting memory",
    title: "Connect a meeting source",
    description:
      "Bring meetings into Taskwise automatically so commitments and follow-ups can surface before they go stale.",
    primaryAction: { label: "Connect a source", href: "/settings?section=integrations" },
    secondaryAction: { label: "See meetings", href: "/meetings" },
  },
  review_meeting: {
    eyebrow: "New commitments detected",
    title: "Review what came out of your latest meetings",
    description:
      "Recent meetings produced suggested work. Confirm the real commitments before they disappear into the backlog.",
    primaryAction: { label: "Review tasks", href: "/review" },
    secondaryAction: { label: "Open meetings", href: "/meetings" },
  },
  prioritize_tasks: {
    eyebrow: "Focus signal",
    title: "Focus the work that matters now",
    description:
      "Taskwise found open work with stronger urgency signals. Use Planning to clear the highest-impact items first.",
    primaryAction: { label: "Open planning", href: "/planning" },
    secondaryAction: { label: "Open board", href: "/workspaces/current/board" },
  },
  prepare_meeting: {
    eyebrow: "Upcoming conversation",
    title: "Prepare the next meeting",
    description:
      "You have upcoming meeting context that can be turned into an agenda using unresolved work and previous commitments.",
    primaryAction: { label: "Prepare agenda", href: "/planning/agendas" },
    secondaryAction: { label: "Open calendar", href: "/calendar" },
  },
  follow_up_people: {
    eyebrow: "Relationship follow-up",
    title: "Follow up with the people who need you",
    description:
      "Recent meetings and open work point to people with unresolved follow-ups. Review their context before the next conversation.",
    primaryAction: { label: "Open people", href: "/people" },
    secondaryAction: { label: "Open clients", href: "/clients" },
  },
  meeting_digest: {
    eyebrow: "Meeting-heavy stretch",
    title: "Catch up on the meetings that matter",
    description:
      "You have had enough recent meetings that a quick pass over decisions, owners, and unresolved work is worth doing now.",
    primaryAction: { label: "Review meetings", href: "/meetings" },
    secondaryAction: { label: "Ask Taskwise", href: "/chat" },
  },
  quiet: {
    eyebrow: "All clear",
    title: "Nothing needs to interrupt you right now",
    description:
      "Taskwise will stay out of the way until there is a stronger meeting, task, or follow-up signal.",
    primaryAction: { label: "Open planning", href: "/planning" },
  },
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const stableDecisionKey = (
  focus: AdaptiveDashboardFocus,
  snapshot: AdaptiveDashboardSnapshot
) =>
  [
    focus,
    snapshot.recentMeetingCount,
    snapshot.meetingsNeedingReview,
    snapshot.urgentTaskCount,
    snapshot.highPriorityTaskCount,
    snapshot.upcomingMeetingCount,
    snapshot.peopleFollowupCount,
    snapshot.recentMeetings[0]?.id || "none",
    snapshot.topTasks[0]?.id || "none",
  ].join(":");

const buildDecision = (
  snapshot: AdaptiveDashboardSnapshot,
  focus: AdaptiveDashboardFocus,
  surface: AdaptiveDashboardSurface,
  source: "jev" | "fallback",
  confidence: number
): AdaptiveDashboardDecision => ({
  source,
  focus,
  surface,
  confidence: clamp01(confidence),
  decisionKey: stableDecisionKey(focus, snapshot),
  ...COPY[focus],
});

export const buildDeterministicAdaptiveDecision = (
  snapshot: AdaptiveDashboardSnapshot
): AdaptiveDashboardDecision => {
  if (snapshot.recentMeetingCount === 0) {
    return buildDecision(snapshot, "connect_meeting_source", "inline", "fallback", 1);
  }

  if (snapshot.meetingsNeedingReview > 0) {
    return buildDecision(snapshot, "review_meeting", "popover", "fallback", 1);
  }

  if (snapshot.urgentTaskCount > 0 || snapshot.highPriorityTaskCount >= 3) {
    return buildDecision(snapshot, "prioritize_tasks", "popover", "fallback", 1);
  }

  if (snapshot.upcomingMeetingCount > 0) {
    return buildDecision(snapshot, "prepare_meeting", "inline", "fallback", 1);
  }

  if (snapshot.peopleFollowupCount >= 2) {
    return buildDecision(snapshot, "follow_up_people", "inline", "fallback", 1);
  }

  if (snapshot.recentMeetingCount >= 6) {
    return buildDecision(snapshot, "meeting_digest", "inline", "fallback", 1);
  }

  return buildDecision(snapshot, "quiet", "none", "fallback", 1);
};

const QUESTIONS = {
  focus: {
    type: "choice",
    instructions:
      "Choose the single most useful Taskwise dashboard intervention right now from the supplied structured state. Prefer quiet when no intervention adds clear value. Do not invent facts or actions.",
    criteria: {
      connect_meeting_source:
        "No useful meeting history exists yet and connecting a source would unlock the product.",
      review_meeting:
        "Recent meetings produced suggested work or commitments that need human review.",
      prioritize_tasks:
        "Open work has meaningful urgency or priority signals and focus would be useful now.",
      prepare_meeting:
        "Upcoming meeting context makes agenda preparation the most useful next action.",
      follow_up_people:
        "Recent people/client context and unresolved work make a relationship follow-up the best next action.",
      meeting_digest:
        "Meeting volume is high enough that reviewing recent decisions and unresolved work is useful.",
      quiet:
        "No dashboard intervention is useful enough to interrupt the user.",
    },
  },
  attention: {
    type: "score",
    instructions:
      "Score how much visual attention the single most useful intervention deserves. Judge interruption level only, not the action itself.",
    criteria: [
      "No interruption",
      "Inline guidance",
      "Popover",
      "Modal-worthy",
    ],
  },
  meeting_digest_useful: {
    type: "noul",
    instructions:
      "Would a digest of recent meeting decisions, commitments, and unresolved work be genuinely useful now?",
  },
  task_focus_useful: {
    type: "noul",
    instructions:
      "Would directing attention to the highest-priority open work be genuinely useful now?",
  },
  people_followup_useful: {
    type: "noul",
    instructions:
      "Would directing attention to people or client follow-ups be genuinely useful now?",
  },
} as const;

const asRecord = (value: unknown): Record<string, any> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;

const asProbability = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;

const isFocus = (value: unknown): value is AdaptiveDashboardFocus =>
  typeof value === "string" &&
  (FOCUS_VALUES as readonly string[]).includes(value);

const isFocusEligible = (
  focus: AdaptiveDashboardFocus,
  snapshot: AdaptiveDashboardSnapshot,
  answers: Record<string, any>
) => {
  if (focus === "connect_meeting_source") return snapshot.recentMeetingCount === 0;
  if (focus === "review_meeting") return snapshot.meetingsNeedingReview > 0;
  if (focus === "prioritize_tasks") {
    const useful = asProbability(asRecord(answers.task_focus_useful)?.noul);
    return snapshot.openTaskCount > 0 && (useful === null || useful >= 0.5);
  }
  if (focus === "prepare_meeting") return snapshot.upcomingMeetingCount > 0;
  if (focus === "follow_up_people") {
    const useful = asProbability(asRecord(answers.people_followup_useful)?.noul);
    return snapshot.peopleFollowupCount > 0 && (useful === null || useful >= 0.5);
  }
  if (focus === "meeting_digest") {
    const useful = asProbability(asRecord(answers.meeting_digest_useful)?.noul);
    return snapshot.recentMeetingCount >= 6 && (useful === null || useful >= 0.5);
  }
  return true;
};

const surfaceFromScore = (
  score: number,
  focusConfidence: number,
  attentionConfidence: number,
  focus: AdaptiveDashboardFocus,
  snapshot: AdaptiveDashboardSnapshot
): AdaptiveDashboardSurface => {
  if (focus === "quiet") return "none";
  if (score < 0.75) return "none";
  if (score < 1.5) return "inline";
  if (score < 2.5) return "popover";

  const strongEvidence =
    (focus === "review_meeting" && snapshot.meetingsNeedingReview >= 2) ||
    (focus === "prioritize_tasks" && snapshot.urgentTaskCount >= 2) ||
    (focus === "prepare_meeting" && snapshot.upcomingMeetingCount >= 2) ||
    (focus === "follow_up_people" && snapshot.peopleFollowupCount >= 3) ||
    (focus === "meeting_digest" && snapshot.recentMeetingCount >= 8) ||
    (focus === "connect_meeting_source" && snapshot.recentMeetingCount === 0);

  return strongEvidence && focusConfidence >= 0.82 && attentionConfidence >= 0.82
    ? "modal"
    : "popover";
};

export async function evaluateAdaptiveDashboard(
  snapshot: AdaptiveDashboardSnapshot,
  options: EvaluateOptions = {}
): Promise<AdaptiveDashboardDecision> {
  const fallback = () => buildDeterministicAdaptiveDecision(snapshot);
  const apiKey = (options.apiKey ?? process.env.TYPESAFE_API_KEY ?? "").trim();
  if (!apiKey) return fallback();

  const fetchImpl = options.fetchImpl ?? fetch;
  const model = (options.model ?? process.env.TYPESAFE_MODEL ?? "jev-latest").trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetchImpl("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state: snapshot,
        model: model || "jev-latest",
        questions: QUESTIONS,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return fallback();

    const payload = asRecord(await response.json());
    const answers = asRecord(payload?.answers);
    const focusAnswer = asRecord(answers?.focus);
    const attentionAnswer = asRecord(answers?.attention);
    const focus = focusAnswer?.choice;
    const focusConfidence = asProbability(focusAnswer?.confidence);
    const attentionConfidence = asProbability(attentionAnswer?.confidence);
    const attentionScore =
      typeof attentionAnswer?.score === "number" &&
      Number.isFinite(attentionAnswer.score) &&
      attentionAnswer.score >= 0 &&
      attentionAnswer.score <= 3
        ? attentionAnswer.score
        : null;

    if (
      !answers ||
      !isFocus(focus) ||
      focusConfidence === null ||
      attentionConfidence === null ||
      attentionScore === null ||
      focusConfidence < 0.5 ||
      attentionConfidence < 0.5 ||
      !isFocusEligible(focus, snapshot, answers)
    ) {
      return fallback();
    }

    return buildDecision(
      snapshot,
      focus,
      surfaceFromScore(
        attentionScore,
        focusConfidence,
        attentionConfidence,
        focus,
        snapshot
      ),
      "jev",
      Math.min(focusConfidence, attentionConfidence)
    );
  } catch {
    return fallback();
  } finally {
    clearTimeout(timeout);
  }
}
