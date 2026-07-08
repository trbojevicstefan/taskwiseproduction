/**
 * POST /api/trello/cards — create Trello cards from Taskwise tasks on a list.
 *
 * Body: { listId, cards: [{ name, desc?, due?, assigneeName?,
 * sourceMeetingUrl?, subtasks? }] } (max 25 cards per request). Assignee text
 * and the source meeting link are appended to the card description; subtasks
 * become a "Subtasks" checklist. Requires an active workspace connection.
 *
 * A token rejection aborts with 401 trello_auth_expired. Other per-card
 * Trello failures are collected: partial success returns 200 with a
 * `failures` array; zero created cards returns 502.
 */

import { z } from "zod";
import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
  parseJsonBody,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  createTrelloCard,
  TrelloAuthError,
  type TrelloCreatedCard,
} from "@/lib/trelloAPI";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import { mapTrelloError, requireActiveTrelloToken } from "../trello-route-helpers";

const ROUTE = "/api/trello/cards";

const MAX_CARDS_PER_REQUEST = 25;
const MAX_NAME_LENGTH = 512;
const MAX_DESC_LENGTH = 8000;
const MAX_SUBTASKS_PER_CARD = 50;

const cardInputSchema = z.object({
  name: z.string().trim().min(1, "Card name is required.").max(MAX_NAME_LENGTH),
  desc: z.string().max(MAX_DESC_LENGTH).optional().nullable(),
  due: z
    .string()
    .trim()
    .max(64)
    .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid due date.")
    .optional()
    .nullable(),
  assigneeName: z.string().trim().max(200).optional().nullable(),
  sourceMeetingUrl: z.string().trim().url().max(500).optional().nullable(),
  subtasks: z
    .array(z.string().trim().min(1).max(500))
    .max(MAX_SUBTASKS_PER_CARD)
    .optional()
    .nullable(),
});

const createCardsSchema = z.object({
  listId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9]{8,64}$/, "Invalid Trello list id."),
  cards: z.array(cardInputSchema).min(1).max(MAX_CARDS_PER_REQUEST),
});

export type TrelloCardRequestInput = z.infer<typeof cardInputSchema>;

/** Appends assignee text and source meeting link to the card description. */
export const composeCardDescription = (card: TrelloCardRequestInput): string => {
  const sections: string[] = [];
  if (card.desc && card.desc.trim()) {
    sections.push(card.desc.trim());
  }
  const metaLines: string[] = [];
  if (card.assigneeName) {
    metaLines.push(`Assignee: ${card.assigneeName}`);
  }
  if (card.sourceMeetingUrl) {
    metaLines.push(`Source meeting: ${card.sourceMeetingUrl}`);
  }
  if (metaLines.length > 0) {
    sections.push(metaLines.join("\n"));
  }
  return sections.join("\n\n---\n\n").slice(0, MAX_DESC_LENGTH);
};

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
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const db = await getDb();
    const { workspaceId } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
    });

    const body = await parseJsonBody(
      request,
      createCardsSchema,
      "Invalid Trello cards payload."
    );

    const token = await requireActiveTrelloToken(db, workspaceId);

    const created: TrelloCreatedCard[] = [];
    const failures: Array<{ name: string; error: string }> = [];

    for (const card of body.cards) {
      try {
        const result = await createTrelloCard(token, {
          listId: body.listId,
          name: card.name,
          desc: composeCardDescription(card) || undefined,
          due: card.due || undefined,
          subtasks: card.subtasks || undefined,
        });
        created.push(result);
      } catch (error) {
        if (error instanceof TrelloAuthError) {
          // Token died mid-batch: abort — every remaining card would fail too.
          throw mapTrelloError(error);
        }
        failures.push({
          name: card.name,
          error:
            error instanceof Error
              ? error.message
              : "Trello card creation failed.",
        });
      }
    }

    if (created.length === 0) {
      emitMetric(502, "error", { reason: "all_cards_failed" });
      return apiError(
        502,
        "trello_api_error",
        failures[0]?.error || "Trello card creation failed.",
        { failures },
        { correlationId }
      );
    }

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      workspaceId,
      createdCount: created.length,
      failureCount: failures.length,
    });
    emitMetric(200, "success", {
      createdCount: created.length,
      failureCount: failures.length,
    });
    return apiSuccess(
      { createdCount: created.length, cards: created, failures },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to create Trello cards.", {
      correlationId,
      logger,
      context: { route: ROUTE, method: "POST", durationMs: durationMs() },
    });
  }
}
