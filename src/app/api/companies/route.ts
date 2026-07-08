import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
  parseJsonBody,
} from "@/lib/api-route";
import {
  createOrReuseCompany,
  listCompaniesForWorkspace,
  serializeCompany,
  syncCompaniesFromClientPeople,
} from "@/lib/companies";
import { getDb } from "@/lib/db";
import { attachCorrelationIdHeader } from "@/lib/observability";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/companies";

const createCompanySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    domain: z.string().trim().max(200).nullable().optional(),
    aliases: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    peopleIds: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  })
  .strict();

const buildWorkspaceFallbackScope = (
  workspaceId: string | null | undefined,
  workspaceMemberUserIds: string[]
) => ({
  $or: [
    { workspaceId },
    {
      workspaceId: { $exists: false },
      userId: { $in: workspaceMemberUserIds },
    },
  ],
});

/**
 * List the workspace's companies. Before listing, client-typed people are run
 * through the resolve-or-create sync so companies are auto-derived from their
 * manual `company` values and email domains (manual assignment wins — see
 * src/lib/companies.ts). The sync is idempotent, so repeated GETs are safe.
 */
export async function GET(request?: Request) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "GET",
  });
  const { correlationId, logger, durationMs, setMetricUserId, emitMetric } =
    routeContext;

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      emitMetric(401, "error", { reason: "unauthorized" });
      logger.warn("api.request.unauthorized", { durationMs: durationMs() });
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } =
      await resolveWorkspaceScopeForUser(db, userId, {
        minimumRole: "member",
        adminVisibilityKey: "people",
        includeMemberUserIds: true,
      });

    const clientPeople = await db
      .collection("people")
      .find({
        $and: [
          buildWorkspaceFallbackScope(workspaceId, workspaceMemberUserIds),
          { personType: "client" },
          { mergeState: { $ne: "merged" } },
          { isBlocked: { $ne: true } },
        ],
      } as any)
      .project({ _id: 1, name: 1, email: 1, company: 1 })
      .toArray();

    if (workspaceId) {
      await syncCompaniesFromClientPeople(db, {
        workspaceId,
        userId,
        people: clientPeople,
      });
    }

    const companies = workspaceId
      ? await listCompaniesForWorkspace(db, workspaceId)
      : [];
    const payload = companies.map(serializeCompany);

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      resultCount: payload.length,
    });
    emitMetric(200, "success", { resultCount: payload.length });
    return attachCorrelationIdHeader(NextResponse.json(payload), correlationId);
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to fetch companies.", {
      correlationId,
      logger,
      context: { route: ROUTE, method: "GET", durationMs: durationMs() },
    });
  }
}

/** Manually create a company (dedupes against existing name/alias/domain). */
export async function POST(request: Request) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "POST",
  });
  const { correlationId, logger, durationMs, setMetricUserId, emitMetric } =
    routeContext;

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      emitMetric(401, "error", { reason: "unauthorized" });
      logger.warn("api.request.unauthorized", { durationMs: durationMs() });
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const body = await parseJsonBody(
      request,
      createCompanySchema,
      "Invalid company payload."
    );

    const db = await getDb();
    const { workspaceId } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
    });
    if (!workspaceId) {
      emitMetric(400, "error", { reason: "no_workspace" });
      return apiError(400, "request_error", "No workspace available.", undefined, {
        correlationId,
      });
    }

    const { company, created } = await createOrReuseCompany(db, {
      workspaceId,
      userId,
      name: body.name,
      domain: body.domain ?? null,
      aliases: body.aliases,
      peopleIds: body.peopleIds,
    });

    logger.info("api.request.succeeded", {
      status: created ? 201 : 200,
      durationMs: durationMs(),
      companyId: company._id,
      operation: created ? "create" : "reuse",
    });
    emitMetric(created ? 201 : 200, "success", {
      companyId: company._id,
      operation: created ? "create" : "reuse",
    });
    return attachCorrelationIdHeader(
      NextResponse.json(serializeCompany(company), {
        status: created ? 201 : 200,
      }),
      correlationId
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to create company.", {
      correlationId,
      logger,
      context: { route: ROUTE, method: "POST", durationMs: durationMs() },
    });
  }
}
