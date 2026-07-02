import { analyzeMeeting } from "@/ai/flows/analyze-meeting-flow";
import { normalizeTask } from "@/lib/data";
import type { ExtractedTaskSchema } from "@/types/chat";
import {
  applyCompletionTargets,
  buildCompletionSuggestions,
  mergeCompletionSuggestions,
} from "@/lib/task-completion";
import * as analysisHelpers from "@/lib/fathom-ingest-analysis";
import * as ingestHelpers from "@/lib/fathom-ingest-helpers";

export const extractFathomMeetingTasks = async (input: {
  db: any;
  user: any;
  userId: string;
  workspaceId: string | null;
  payload: any;
  transcriptText: string;
  summaryText?: string | null;
  meetingTitleFromPayload?: string | null;
}) => {
  const detailLevel = analysisHelpers.resolveDetailLevel(input.user);
  const analysisResult = await analyzeMeeting({
    transcript: input.transcriptText,
    requestedDetailLevel: detailLevel,
  });

  const allTaskLevels = analysisResult.allTaskLevels || null;
  const selectedTasks = analysisHelpers.selectTasksForLevel(allTaskLevels, detailLevel);

  const sanitizedTasks = selectedTasks.map((task: any) =>
    normalizeTask(task as ExtractedTaskSchema)
  );
  let sanitizedTaskLevels = analysisHelpers.sanitizeLevels(allTaskLevels);

  const uniquePeople = ingestHelpers.buildUniqueMeetingPeople(analysisResult, input.payload);

  const completionMatchThreshold = analysisHelpers.resolveCompletionMatchThreshold(input.user);
  const completionSummary =
    ingestHelpers.pickFirst(
      analysisResult.meetingSummary,
      analysisResult.chatResponseText,
      input.summaryText
    ) || "";
  const completionSuggestions = await buildCompletionSuggestions({
    userId: input.userId,
    transcript: input.transcriptText,
    summary: completionSummary,
    attendees: uniquePeople,
    workspaceId: input.workspaceId,
    requireAttendeeMatch: false,
    minMatchRatio: completionMatchThreshold,
  });

  const shouldAutoApprove = Boolean(input.user.autoApproveCompletedTasks);
  if (shouldAutoApprove && completionSuggestions.length) {
    const autoApproveSuggestions = completionSuggestions.filter((task: any) =>
      analysisHelpers.shouldAutoApproveSuggestion(task, completionMatchThreshold)
    );
    if (autoApproveSuggestions.length) {
      await applyCompletionTargets(input.db, input.userId, autoApproveSuggestions);
    }
  }

  const mergedTasks = mergeCompletionSuggestions(
    sanitizedTasks,
    completionSuggestions
  );
  const finalizedTasks = shouldAutoApprove
    ? analysisHelpers.applyAutoApprovalFlags(mergedTasks, completionMatchThreshold)
    : mergedTasks;

  if (sanitizedTaskLevels) {
    sanitizedTaskLevels = {
      light: mergeCompletionSuggestions(
        sanitizedTaskLevels.light || [],
        completionSuggestions
      ),
      medium: mergeCompletionSuggestions(
        sanitizedTaskLevels.medium || [],
        completionSuggestions
      ),
      detailed: mergeCompletionSuggestions(
        sanitizedTaskLevels.detailed || [],
        completionSuggestions
      ),
    };
    if (shouldAutoApprove) {
      sanitizedTaskLevels = {
        light: analysisHelpers.applyAutoApprovalFlags(
          sanitizedTaskLevels.light || [],
          completionMatchThreshold
        ),
        medium: analysisHelpers.applyAutoApprovalFlags(
          sanitizedTaskLevels.medium || [],
          completionMatchThreshold
        ),
        detailed: analysisHelpers.applyAutoApprovalFlags(
          sanitizedTaskLevels.detailed || [],
          completionMatchThreshold
        ),
      };
    }
  }

  const meetingTitle = ingestHelpers.pickFirst(
    input.meetingTitleFromPayload,
    analysisResult.sessionTitle,
    "Fathom Meeting"
  );

  const meetingSummary =
    ingestHelpers.pickFirst(
      analysisResult.meetingSummary,
      analysisResult.chatResponseText,
      input.summaryText
    ) || "";

  return {
    analysisResult,
    allTaskLevels,
    sanitizedTasks,
    sanitizedTaskLevels,
    uniquePeople,
    completionMatchThreshold,
    completionSuggestions,
    finalizedTasks,
    meetingTitle,
    meetingSummary,
  };
};
