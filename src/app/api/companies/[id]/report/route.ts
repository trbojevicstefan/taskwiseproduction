import { z } from "zod";
import { generateProfileReport } from "@/ai/flows/profile-report-flow";
import {
  ApiRouteError,
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import { findCompanyById } from "@/lib/companies";
import { getDb } from "@/lib/db";
import {
  buildNoEvidenceReport,
  filterReportSources,
  gatherProfileReportEvidence,
} from "@/lib/profile-report";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/companies/[id]/report";

// The report needs no input today; an empty body or empty JSON object is the
// only accepted payload so future options stay backward-compatible.
const requestSchema = z.object({}).strict();

const assertEmptyBody = async (request: Request): Promise<void> => {
  const raw = await request.text().catch(() => "");
  if (!raw.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiRouteError(400, "invalid_json", "Invalid JSON body.");
  }
  const result = requestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiRouteError(
      400,
      "invalid_payload",
      "Invalid report payload.",
      result.error.flatten()
    );
  }
};

/**
 * One-click company report: gathers the company's people, meetings, tasks,
 * and transcript mentions, then composes a source-grounded report via
 * gpt-4o-mini (runPromptWithFallback). No evidence => deterministic report
 * without any LLM call. LLM-cited sources are filtered against the gathered
 * ids, mirroring the /api/ai/chat anti-hallucination contract.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "POST",
  });
  const { correlationId, logger, durationMs, setMetricUserId, emitMetric } =
    routeContext;

  try {
    const { id } = await params;
    const userId = await getSessionUserId();
    if (!userId) {
      emitMetric(401, "error", { reason: "unauthorized" });
      logger.warn("api.request.unauthorized", { durationMs: durationMs() });
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    await assertEmptyBody(request);

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } =
      await resolveWorkspaceScopeForUser(db, userId, {
        minimumRole: "member",
        adminVisibilityKey: "people",
        includeMemberUserIds: true,
      });
    if (!workspaceId) {
      emitMetric(404, "error", { reason: "company_not_found" });
      return apiError(404, "request_error", "Company not found", undefined, {
        correlationId,
      });
    }

    const company = await findCompanyById(db, workspaceId, id);
    if (!company) {
      emitMetric(404, "error", { reason: "company_not_found" });
      return apiError(404, "request_error", "Company not found", undefined, {
        correlationId,
      });
    }

    const peopleIds = (company.peopleIds || []).map(String);
    const people = peopleIds.length
      ? await db
          .collection("people")
          .find({
            $and: [
              {
                $or: [
                  { workspaceId },
                  {
                    workspaceId: { $exists: false },
                    userId: { $in: workspaceMemberUserIds },
                  },
                ],
              },
              { _id: { $in: peopleIds } },
              { mergeState: { $ne: "merged" } },
            ],
          } as any)
          .toArray()
      : [];

    const evidence = await gatherProfileReportEvidence(
      db,
      { userId, workspaceId, memberUserIds: workspaceMemberUserIds },
      {
        type: "company",
        name: company.name,
        people,
        domain: company.domain,
      }
    );

    if (evidence.isEmpty) {
      const data = buildNoEvidenceReport("company", company.name);
      logger.info("api.request.succeeded", {
        status: 200,
        durationMs: durationMs(),
        outcome: "no_evidence",
      });
      emitMetric(200, "success", { outcome: "no_evidence" });
      return apiSuccess({ data }, { correlationId });
    }

    const report = await generateProfileReport(
      {
        subjectType: "company",
        subjectName: company.name,
        contextBlocks: evidence.contextBlocks,
        today: new Date().toISOString().slice(0, 10),
      },
      { correlationId, userId }
    );

    const data = filterReportSources(report, evidence);

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      outcome: "report_generated",
      confidence: data.confidence,
      sourceCount: data.sources.length,
      droppedSourceCount: report.sources.length - data.sources.length,
    });
    emitMetric(200, "success", {
      outcome: "report_generated",
      confidence: data.confidence,
      sourceCount: data.sources.length,
    });
    return apiSuccess({ data }, { correlationId });
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to generate company report.", {
      correlationId,
      logger,
      context: { route: ROUTE, method: "POST", durationMs: durationMs() },
    });
  }
}
