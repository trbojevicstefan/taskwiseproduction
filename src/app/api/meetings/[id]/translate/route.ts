import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
const OPENAI_RESPONSES_URL =
  process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";

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

const toResponsesInput = (
  messages: Array<{ role: string; content: string }>
) =>
  messages.map((message: any) => ({
    role: message.role,
    content: [
      {
        type: "input_text",
        text: message.content,
      },
    ],
  }));

const extractResponsesText = (payload: unknown): string => {
  if (!payload || typeof payload !== "object") return "";
  const payloadObj = payload as { output_text?: unknown; output?: unknown };
  if (typeof payloadObj.output_text === "string") return payloadObj.output_text;
  const output = Array.isArray(payloadObj.output) ? payloadObj.output : [];
  for (const item of output) {
    const message = item as { type?: unknown; content?: unknown };
    const content = Array.isArray(message.content) ? message.content : [];
    if (message.type === "message" && content.length) {
      const text = content
        .map((part: any) => {
          const outputPart = part as { type?: unknown; text?: unknown };
          return outputPart.type === "output_text" && typeof outputPart.text === "string"
            ? outputPart.text
            : "";
        })
        .join("");
      if (text) return text;
    }
  }
  return "";
};

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
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: toResponsesInput(buildTranslateMessages(transcript, targetLanguage)),
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
  const translatedTranscript = extractResponsesText(payload);
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
      return apiError(401, "request_error", "Unauthorized");
    }

    const body = await request.json().catch(() => ({}));
    const targetLanguage =
      typeof body?.targetLanguage === "string" ? body.targetLanguage.trim() : "";
    if (!targetLanguage) {
      return apiError(400, "request_error", "Target language is required.");
    }

    const db = await getDb();
    const filter = {
      userId,
      $or: [{ _id: id }, { id }],
    };
    const meeting = await db.collection("meetings").findOne(filter);
    if (!meeting || meeting.isHidden) {
      return apiError(404, "request_error", "Meeting not found.");
    }

    const transcript =
      typeof meeting.originalTranscript === "string"
        ? meeting.originalTranscript
        : "";
    if (!transcript.trim()) {
      return apiError(400, "request_error", "Transcript not available.");
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




