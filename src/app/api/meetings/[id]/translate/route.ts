import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
const OPENAI_CHAT_URL =
  process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";

const buildTranslateMessages = (transcript: string, targetLanguage: string) => [
  {
    role: "system",
    content: [
      "You are a translation engine.",
      `Translate the transcript into ${targetLanguage}.`,
      "Rules:",
      "- Preserve all timestamps, speaker names, emails, URLs, IDs, and bracketed metadata exactly.",
      "- Keep the line breaks, indentation, and spacing identical to the input.",
      "- Do NOT add, remove, or reorder lines.",
      "- Only translate the spoken content.",
      "",
      "Return only the translated transcript. No commentary, no quotes, no code fences.",
    ].join("\n"),
  },
  {
    role: "user",
    content: `Transcript:\n<<<TRANSCRIPT\n${transcript}\nTRANSCRIPT`,
  },
];

const translateTranscriptWithOpenAI = async (
  transcript: string,
  targetLanguage: string
) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to translate transcripts.");
  }
  const model =
    process.env.OPENAI_TRANSLATE_MODEL ||
    process.env.OPENAI_MODEL ||
    "gpt-4.1";
  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: buildTranslateMessages(transcript, targetLanguage),
      temperature: 0.2,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage =
      (payload as { error?: { message?: string } })?.error?.message ||
      `OpenAI translation failed (HTTP ${response.status}).`;
    throw new Error(errorMessage);
  }
  const translatedTranscript =
    (payload as { choices?: Array<{ message?: { content?: string } }> })
      ?.choices?.[0]?.message?.content || "";
  if (!translatedTranscript.trim()) {
    throw new Error("OpenAI returned empty translation.");
  }
  return translatedTranscript;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const model = process.env.OPENAI_TRANSLATE_MODEL || process.env.OPENAI_MODEL;
  try {
    const { id } = await params;
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const targetLanguage =
      typeof body?.targetLanguage === "string" ? body.targetLanguage.trim() : "";
    if (!targetLanguage) {
      return NextResponse.json(
        { error: "Target language is required." },
        { status: 400 }
      );
    }

    const db = await getDb();
    const idQuery = buildIdQuery(id);
    const userIdQuery = buildIdQuery(userId);
    const filter = {
      userId: userIdQuery,
      $or: [{ _id: idQuery }, { id }],
    };
    const meeting = await db.collection<any>("meetings").findOne(filter);
    if (!meeting || meeting.isHidden) {
      return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
    }

    const transcript =
      typeof meeting.originalTranscript === "string"
        ? meeting.originalTranscript
        : "";
    if (!transcript.trim()) {
      return NextResponse.json(
        { error: "Transcript not available." },
        { status: 400 }
      );
    }

    try {
      const translatedTranscript = await translateTranscriptWithOpenAI(
        transcript,
        targetLanguage
      );
      return NextResponse.json({ translatedTranscript });
    } catch (error) {
      const errorId = randomUUID();
      const message = error instanceof Error ? error.message : String(error);
      console.error("Transcript translation failed:", {
        errorId,
        message,
        model,
        error,
      });
      const responsePayload: {
        error: string;
        reference?: string;
        details?: string;
        model?: string;
      } = {
        error: "Translation failed.",
        reference: errorId,
      };
      if (process.env.NODE_ENV !== "production") {
        responsePayload.details = message;
        if (model) {
          responsePayload.model = model;
        }
      }
      return NextResponse.json(responsePayload, { status: 500 });
    }
  } catch (error) {
    const errorId = randomUUID();
    const message = error instanceof Error ? error.message : String(error);
    console.error("Translate route failed:", { errorId, message, model, error });
    const responsePayload: {
      error: string;
      reference?: string;
      details?: string;
      model?: string;
    } = {
      error: "Translation failed.",
      reference: errorId,
    };
    if (process.env.NODE_ENV !== "production") {
      responsePayload.details = message;
      if (model) {
        responsePayload.model = model;
      }
    }
    return NextResponse.json(responsePayload, { status: 500 });
  }
}
