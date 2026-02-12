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

    if (!(fileValue instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const outgoing = new FormData();
    outgoing.set("file", fileValue, fileValue.name || "identify.jpg");

    const upstream = await fetch(`${faceApiBase}/identify`, {
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
