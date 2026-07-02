import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/server-auth";

type OperationalRouteAccess =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: NextResponse;
    };

const getAllowedUserIds = () =>
  new Set(
    (process.env.OPERATIONAL_ROUTE_ALLOWED_USER_IDS || "")
      .split(",")
      .map((value: any) => value.trim())
      .filter(Boolean)
  );

export const requireOperationalRouteAccess = async (): Promise<OperationalRouteAccess> => {
  if (process.env.ENABLE_OPERATIONAL_ROUTES !== "1") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const allowedUserIds = getAllowedUserIds();
  if (allowedUserIds.size && !allowedUserIds.has(userId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, userId };
};

