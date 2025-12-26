import { NextResponse } from "next/server";
import { findUserByFathomWebhookToken } from "@/lib/db/users";

const truncate = (value: string, limit = 500) =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;

export async function POST(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const rawBody = await request.text();

  let userId: string | null = null;
  if (token) {
    const user = await findUserByFathomWebhookToken(token);
    userId = user?._id?.toString?.() || null;
  }

  console.log("Fathom webhook debug received", {
    userId,
    tokenPresent: Boolean(token),
    length: rawBody.length,
    webhookId: request.headers.get("webhook-id"),
    webhookTimestamp: request.headers.get("webhook-timestamp"),
    webhookSignature: request.headers.get("webhook-signature") ? "present" : "missing",
    preview: truncate(rawBody),
  });

  return NextResponse.json({ status: "ok" });
}
