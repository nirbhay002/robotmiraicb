import { NextResponse } from "next/server";
import { buildRealtimeInstructions } from "../../../lib/miraiPolicy";

const REALTIME_MODEL = "gpt-realtime-2025-08-28";

function extractUpstreamMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as {
    error?: { message?: string; code?: string };
    message?: string;
  };

  if (typeof candidate.error?.message === "string") {
    const code = candidate.error.code ? ` (${candidate.error.code})` : "";
    return `${candidate.error.message}${code}`;
  }
  if (typeof candidate.message === "string") {
    return candidate.message;
  }
  return null;
}

function parseJsonSafely(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawName =
      typeof body?.userName === "string" ? body.userName.trim() : "";
    const userName = rawName.length > 0 ? rawName : "Guest";

    const sessionResp = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: REALTIME_MODEL,
          modalities: ["audio", "text"],
          instructions: buildRealtimeInstructions(userName),
        }),
      }
    );

    const rawBody = await sessionResp.text();
    const sessionJson = parseJsonSafely(rawBody) ?? {};
    if (!sessionResp.ok) {
      const upstreamMessage =
        extractUpstreamMessage(sessionJson) ||
        (rawBody.trim().length > 0 ? rawBody : null) ||
        `OpenAI returned HTTP ${sessionResp.status}`;
      return NextResponse.json(
        {
          error: `Failed to create realtime session: ${upstreamMessage}`,
          detail: sessionJson,
        },
        { status: 502 }
      );
    }

    const clientSecret = (sessionJson as { client_secret?: { value?: string } })
      ?.client_secret;
    if (!clientSecret?.value) {
      return NextResponse.json(
        { error: "Realtime session did not return a client secret" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      model: REALTIME_MODEL,
      client_secret: clientSecret,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected session error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
