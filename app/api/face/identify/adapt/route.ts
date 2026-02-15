import { NextResponse } from "next/server";

function getFaceApiBase(): string {
  const value = process.env.FACE_API_BASE?.trim();
  if (!value) {
    throw new Error("FACE_API_BASE is not configured");
  }
  return value.replace(/\/+$/, "");
}

export async function POST(req: Request) {
  try {
    const faceApiBase = getFaceApiBase();
    const incoming = await req.formData();
    const fileValue = incoming.get("file");
    const userId = incoming.get("user_id");
    const sessionId = incoming.get("session_id");

    if (!(fileValue instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (typeof userId !== "string" || !userId.trim()) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const outgoing = new FormData();
    outgoing.set("file", fileValue, fileValue.name || "identify-adapt.jpg");
    outgoing.set("user_id", userId.trim());
    if (typeof sessionId === "string" && sessionId.trim()) {
      outgoing.set("session_id", sessionId.trim());
    }

    const upstream = await fetch(`${faceApiBase}/identify/adapt`, {
      method: "POST",
      body: outgoing,
      headers: {
        ...(req.headers.get("x-session-id")
          ? { "x-session-id": req.headers.get("x-session-id") as string }
          : {}),
      },
    });

    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected proxy error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
