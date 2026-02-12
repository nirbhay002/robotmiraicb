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

    const nameValue = incoming.get("name");
    const fileValue = incoming.get("file");

    if (typeof nameValue !== "string" || !nameValue.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    if (!(fileValue instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const outgoing = new FormData();
    outgoing.set("name", nameValue.trim());
    outgoing.set("file", fileValue, fileValue.name || "register.jpg");

    const upstream = await fetch(`${faceApiBase}/register`, {
      method: "POST",
      body: outgoing,
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
