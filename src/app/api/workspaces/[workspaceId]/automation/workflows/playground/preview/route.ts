import { z } from "zod";
import {
  AUTOMATION_WORKFLOW_FILTER_OPERATORS,
  type AutomationWorkflowFilter,
} from "@/lib/automation-workflows";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import {
  buildCanonicalWorkflowPayloadForAutomation,
  evaluateAutomationWorkflowFilters,
  runAutomationWorkflowTransform,
  selectAutomationWorkflowPayload,
} from "@/lib/meeting-workflow-automation";
import { serializeError } from "@/lib/observability";
import { getWorkflowGuardrailConfig } from "@/lib/workflow-guardrails";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const workflowFilterSchema = z.object({
  field: z.string().trim().min(1).max(120),
  operator: z.enum(AUTOMATION_WORKFLOW_FILTER_OPERATORS),
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.union([z.string(), z.number(), z.boolean()])),
    ])
    .optional(),
  caseSensitive: z.boolean().optional(),
});

const workflowFieldSelectionSchema = z.object({
  mode: z.enum(["all", "subset"]).default("all"),
  fields: z.array(z.string().trim().min(1).max(120)).default([]),
});

const workflowTransformSchema = z.object({
  runtime: z.literal("quickjs").default("quickjs"),
  script: z.string().max(20_000).nullable().optional(),
  timeoutMs: z.number().int().min(100).max(10_000).default(1_000),
});

const playgroundPreviewSchema = z.object({
  workflow: z.object({
    trigger: z.enum(["meeting.ingested", "meeting.updated"]),
    filters: z.array(workflowFilterSchema).default([]),
    fieldSelection: workflowFieldSelectionSchema.default({
      mode: "all",
      fields: [],
    }),
    transform: workflowTransformSchema.default({
      runtime: "quickjs",
      script: null,
      timeoutMs: 1_000,
    }),
  }),
  previewMeetingId: z.string().trim().min(1).max(200).nullable().optional(),
  meetingLimit: z.number().int().min(1).max(25).default(12),
});

const MEETING_PREVIEW_PROJECTION = {
  _id: 1,
  id: 1,
  workspaceId: 1,
  title: 1,
  summary: 1,
  originalTranscript: 1,
  attendees: 1,
  extractedTasks: 1,
  tags: 1,
  meetingMetadata: 1,
  recordingUrl: 1,
  shareUrl: 1,
  startTime: 1,
  endTime: 1,
  duration: 1,
  connectionId: 1,
  providerSourceId: 1,
  createdAt: 1,
  lastActivityAt: 1,
  isHidden: 1,
} as const;

const toIsoStringOrNull = (value: unknown) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as any);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toMeetingId = (meeting: any) =>
  String(meeting?._id || meeting?.id || "").trim();

const normalizeMeetingList = (meetings: any[]) => {
  const seen = new Set<string>();
  const unique: any[] = [];
  meetings.forEach((meeting) => {
    const meetingId = toMeetingId(meeting);
    if (!meetingId || seen.has(meetingId)) {
      return;
    }
    seen.add(meetingId);
    unique.push(meeting);
  });
  return unique;
};

const toLimitedPreviewValue = (
  value: unknown,
  maxBytes: number
): {
  value: unknown;
  bytes: number | null;
  truncated: boolean;
  error: string | null;
} => {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      return {
        value: null,
        bytes: null,
        truncated: false,
        error: "Value is not JSON-serializable.",
      };
    }
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > maxBytes) {
      return {
        value: null,
        bytes,
        truncated: true,
        error: `Preview exceeded ${maxBytes} bytes.`,
      };
    }
    return {
      value: JSON.parse(serialized),
      bytes,
      truncated: false,
      error: null,
    };
  } catch (error) {
    return {
      value: null,
      bytes: null,
      truncated: false,
      error: error instanceof Error ? error.message : "Failed to serialize preview value.",
    };
  }
};

const toPayloadFilterSource = (payload: unknown) =>
  payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : ({} as Record<string, unknown>);

const toPreviewMeetingSummary = (meeting: any, matched: boolean) => ({
  id: toMeetingId(meeting),
  title: typeof meeting?.title === "string" && meeting.title.trim() ? meeting.title : "Meeting",
  summary:
    typeof meeting?.summary === "string" && meeting.summary.trim()
      ? meeting.summary
      : null,
  lastActivityAt: toIsoStringOrNull(meeting?.lastActivityAt),
  matched,
});

const toFilterPayload = (meeting: any, workspaceId: string) => ({
  meetingId: toMeetingId(meeting),
  workspaceId,
  title: typeof meeting?.title === "string" ? meeting.title : null,
  transcript:
    typeof meeting?.originalTranscript === "string" ? meeting.originalTranscript : null,
  attendees: Array.isArray(meeting?.attendees) ? meeting.attendees : [],
  extractedTasks: Array.isArray(meeting?.extractedTasks) ? meeting.extractedTasks : [],
  tags: Array.isArray(meeting?.tags) ? meeting.tags : [],
});

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: { workspaceId: string } | Promise<{ workspaceId: string }>;
  }
) {
  try {
    const { workspaceId: rawWorkspaceId } = await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }

    const access = await requireWorkspaceRouteAccess(workspaceId, "member", {
      adminVisibilityKey: "integrations",
    });
    if (!access.ok) {
      return access.response;
    }

    const input = await parseJsonBody(
      request,
      playgroundPreviewSchema,
      "Invalid workflow playground payload."
    );
    const workflow = input.workflow;
    const meetingLimit = Math.max(1, Math.min(25, input.meetingLimit || 12));
    const previewMeetingId = input.previewMeetingId?.trim() || null;

    const baseMeetings = await access.db
      .collection("meetings")
      .find(
        {
          workspaceId,
          isHidden: { $ne: true },
        },
        {
          projection: MEETING_PREVIEW_PROJECTION,
        }
      )
      .sort({ lastActivityAt: -1, _id: -1 })
      .limit(meetingLimit)
      .toArray();

    let selectedPreviewMeeting: any | null = null;
    if (previewMeetingId) {
      selectedPreviewMeeting = await access.db.collection("meetings").findOne(
        {
          workspaceId,
          isHidden: { $ne: true },
          $or: [{ _id: previewMeetingId }, { id: previewMeetingId }],
        },
        {
          projection: MEETING_PREVIEW_PROJECTION,
        }
      );
    }

    const meetings = normalizeMeetingList([
      ...(selectedPreviewMeeting ? [selectedPreviewMeeting] : []),
      ...baseMeetings,
    ]);

    const filters = Array.isArray(workflow.filters)
      ? (workflow.filters as AutomationWorkflowFilter[])
      : [];
    const canonicalPayloadByMeetingId = new Map<string, Record<string, unknown>>();
    const meetingSummaries = meetings.map((meeting) => {
      const canonicalPayload = buildCanonicalWorkflowPayloadForAutomation({
        eventType: workflow.trigger,
        workspaceId,
        payload: toFilterPayload(meeting, workspaceId),
        meetingDoc: meeting,
      });
      const canonicalAsRecord = toPayloadFilterSource(canonicalPayload);
      const matched = evaluateAutomationWorkflowFilters(canonicalAsRecord, filters);
      const meetingId = toMeetingId(meeting);
      canonicalPayloadByMeetingId.set(meetingId, canonicalAsRecord);
      return toPreviewMeetingSummary(meeting, matched);
    });

    const matchedMeetingSummaries = meetingSummaries.filter((meeting) => meeting.matched);
    const selectedMeetingSummary =
      (previewMeetingId
        ? meetingSummaries.find((meeting) => meeting.id === previewMeetingId)
        : null) ||
      matchedMeetingSummaries[0] ||
      meetingSummaries[0] ||
      null;
    const selectedMeetingCanonicalPayload = selectedMeetingSummary
      ? canonicalPayloadByMeetingId.get(selectedMeetingSummary.id) || null
      : null;

    const fieldSelection = workflow.fieldSelection || {
      mode: "all" as const,
      fields: [],
    };
    const selectedPayload =
      selectedMeetingCanonicalPayload &&
      selectAutomationWorkflowPayload(selectedMeetingCanonicalPayload, fieldSelection);

    let transformOutput: unknown = null;
    let transformError: ReturnType<typeof serializeError> | null = null;
    if (selectedPayload && typeof selectedPayload === "object") {
      try {
        transformOutput = await runAutomationWorkflowTransform(
          selectedPayload as Record<string, unknown>,
          {
            workflowId: "playground-preview",
            transform: {
              runtime: "quickjs",
              script: workflow.transform?.script || null,
              timeoutMs: workflow.transform?.timeoutMs || 1_000,
            },
          }
        );
      } catch (error) {
        transformError = serializeError(error);
      }
    }

    const guardrails = getWorkflowGuardrailConfig();
    const previewLimitBytes = Math.max(
      16 * 1024,
      Math.min(guardrails.transformOutputLimitBytes, 256 * 1024)
    );
    const selectedPayloadPreview = toLimitedPreviewValue(
      selectedPayload ?? null,
      previewLimitBytes
    );
    const transformOutputPreview = toLimitedPreviewValue(
      transformOutput,
      previewLimitBytes
    );

    return apiSuccess({
      workspaceId,
      trigger: workflow.trigger,
      consideredMeetingCount: meetingSummaries.length,
      matchedMeetingCount: matchedMeetingSummaries.length,
      meetings: meetingSummaries,
      selectedMeeting: selectedMeetingSummary,
      selectedPayload: selectedPayloadPreview.value,
      selectedPayloadBytes: selectedPayloadPreview.bytes,
      selectedPayloadTruncated: selectedPayloadPreview.truncated,
      selectedPayloadError: selectedPayloadPreview.error,
      transformOutput: transformOutputPreview.value,
      transformOutputBytes: transformOutputPreview.bytes,
      transformOutputTruncated: transformOutputPreview.truncated,
      transformOutputError:
        transformError || (transformOutputPreview.error ? { message: transformOutputPreview.error } : null),
    });
  } catch (error) {
    return mapApiError(error, "Failed to build workflow playground preview.");
  }
}

