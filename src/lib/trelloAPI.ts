// src/lib/trelloAPI.ts
//
// Server-side Trello REST client plus the shared response types used by the
// Push-to-Trello UI. Client components must only `import type` from this
// module (the type imports are erased at build time); the functions below
// read TRELLO_API_KEY from the server environment.
//
// Auth model: Trello's client-side authorize URL with `response_type=token`.
// The user opens the authorize URL, approves access, copies the token Trello
// displays, and pastes it into Taskwise. The exchange route validates the
// token against `GET /1/members/me` before storing it. (OAuth1.0a — which
// would use TRELLO_API_SECRET / TRELLO_REDIRECT_URI — is intentionally not
// used: the paste flow needs no callback route and matches the repo's
// paste-credential integration pattern from Fireflies/Grain.)

export interface TrelloBoard {
  id: string;
  name: string;
  url: string;
}

export interface TrelloList {
  id: string;
  name: string;
}

export interface TrelloMember {
  id: string;
  username: string;
  fullName: string | null;
}

export interface TrelloCreatedCard {
  id: string;
  name: string;
  url: string;
}

export interface TrelloCardInput {
  listId: string;
  name: string;
  desc?: string | null;
  due?: string | null;
  subtasks?: string[] | null;
}

const TRELLO_API_BASE_URL = "https://api.trello.com/1";

/** Thrown when Trello rejects the stored token (revoked/expired). */
export class TrelloAuthError extends Error {
  constructor(message = "Trello rejected the stored authorization token.") {
    super(message);
    this.name = "TrelloAuthError";
  }
}

/** Thrown for non-auth Trello API failures. Never includes key/token. */
export class TrelloApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TrelloApiError";
    this.status = status;
  }
}

export const getTrelloApiKey = (): string | null => {
  const key = (process.env.TRELLO_API_KEY || "").trim();
  return key || null;
};

export const isTrelloConfigured = () => Boolean(getTrelloApiKey());

/**
 * Client-side authorize URL. Without a `return_url` Trello displays the
 * generated token for the user to copy — that is deliberate: the connect UI
 * asks the user to paste the token back into Taskwise.
 */
export const buildTrelloAuthorizeUrl = (
  options: { appName?: string } = {}
): string | null => {
  const key = getTrelloApiKey();
  if (!key) return null;
  const params = new URLSearchParams({
    expiration: "never",
    name: options.appName || "Taskwise",
    scope: "read,write",
    response_type: "token",
    key,
  });
  return `https://trello.com/1/authorize?${params.toString()}`;
};

const trelloRequest = async <T>(
  path: string,
  token: string,
  options: {
    method?: string;
    searchParams?: Record<string, string | undefined | null>;
  } = {}
): Promise<T> => {
  const key = getTrelloApiKey();
  if (!key) {
    throw new TrelloApiError(
      503,
      "Trello is not configured on the server (TRELLO_API_KEY is missing)."
    );
  }

  const url = new URL(`${TRELLO_API_BASE_URL}${path}`);
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);
  for (const [name, value] of Object.entries(options.searchParams || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(name, value);
    }
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), { method: options.method || "GET" });
  } catch {
    throw new TrelloApiError(502, "Could not reach the Trello API.");
  }

  if (response.status === 401) {
    throw new TrelloAuthError();
  }
  if (!response.ok) {
    // Do not echo the response body verbatim — keep messages generic and
    // guaranteed free of credentials.
    throw new TrelloApiError(
      response.status,
      `Trello API request failed (${path.split("?")[0]} -> ${response.status}).`
    );
  }

  return (await response.json()) as T;
};

/** Validates a token by loading the member it belongs to. */
export const fetchTrelloMember = async (token: string): Promise<TrelloMember> => {
  const member = await trelloRequest<{
    id?: string;
    username?: string;
    fullName?: string | null;
  }>("/members/me", token, {
    searchParams: { fields: "id,username,fullName" },
  });
  if (!member?.id) {
    throw new TrelloAuthError("Trello did not return a member for this token.");
  }
  return {
    id: member.id,
    username: member.username || "",
    fullName: member.fullName || null,
  };
};

export const fetchTrelloBoards = async (token: string): Promise<TrelloBoard[]> => {
  const boards = await trelloRequest<Array<{ id?: string; name?: string; url?: string }>>(
    "/members/me/boards",
    token,
    { searchParams: { fields: "id,name,url", filter: "open" } }
  );
  if (!Array.isArray(boards)) return [];
  return boards
    .filter((board) => Boolean(board?.id))
    .map((board) => ({
      id: String(board.id),
      name: String(board.name || "Untitled board"),
      url: String(board.url || ""),
    }));
};

export const fetchTrelloBoardLists = async (
  token: string,
  boardId: string
): Promise<TrelloList[]> => {
  const lists = await trelloRequest<Array<{ id?: string; name?: string }>>(
    `/boards/${encodeURIComponent(boardId)}/lists`,
    token,
    { searchParams: { fields: "id,name", filter: "open" } }
  );
  if (!Array.isArray(lists)) return [];
  return lists
    .filter((list) => Boolean(list?.id))
    .map((list) => ({
      id: String(list.id),
      name: String(list.name || "Untitled list"),
    }));
};

/**
 * Creates one card; when `subtasks` are provided they are attached as a
 * "Subtasks" checklist on the new card.
 */
export const createTrelloCard = async (
  token: string,
  input: TrelloCardInput
): Promise<TrelloCreatedCard> => {
  const card = await trelloRequest<{ id?: string; name?: string; url?: string }>(
    "/cards",
    token,
    {
      method: "POST",
      searchParams: {
        idList: input.listId,
        name: input.name,
        desc: input.desc || undefined,
        due: input.due || undefined,
      },
    }
  );
  if (!card?.id) {
    throw new TrelloApiError(502, "Trello did not return the created card.");
  }

  const subtasks = (input.subtasks || []).filter(
    (item) => typeof item === "string" && item.trim()
  );
  if (subtasks.length > 0) {
    const checklist = await trelloRequest<{ id?: string }>("/checklists", token, {
      method: "POST",
      searchParams: { idCard: card.id, name: "Subtasks" },
    });
    if (checklist?.id) {
      for (const item of subtasks) {
        await trelloRequest(`/checklists/${encodeURIComponent(checklist.id)}/checkItems`, token, {
          method: "POST",
          searchParams: { name: item.trim() },
        });
      }
    }
  }

  return {
    id: String(card.id),
    name: String(card.name || input.name),
    url: String(card.url || ""),
  };
};
