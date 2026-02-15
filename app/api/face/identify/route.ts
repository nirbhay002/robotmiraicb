import { NextResponse } from "next/server";
import { recordFaceMetricEvent } from "@/app/lib/faceMetricsDb";

export const runtime = "nodejs";

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function safeRecordFaceMetricEvent(
  input: Parameters<typeof recordFaceMetricEvent>[0]
): void {
  try {
    recordFaceMetricEvent(input);
  } catch (err) {
    console.error("Failed to persist face metrics event:", err);
  }
}

function getFaceApiBase(): string {
  const value = process.env.FACE_API_BASE?.trim();
  if (!value) {
    throw new Error("FACE_API_BASE is not configured");
  }
  return value.replace(/\/+$/, "");
}

export async function POST(req: Request) {
  const requestStartedAt = Date.now();
  const sessionId = req.headers.get("x-session-id");

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
      headers: {
        ...(req.headers.get("x-session-id")
          ? { "x-session-id": req.headers.get("x-session-id") as string }
          : {}),
      },
    });
    const gatewayUpstreamMs = Date.now() - requestStartedAt;

    const bodyText = await upstream.text();
    const contentType = upstream.headers.get("content-type") ?? "application/json";

    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      const serverProcessingMs = asOptionalNumber(parsed.latency_ms);
      const status = typeof parsed.status === "string" ? parsed.status : null;
      const reason = typeof parsed.reason === "string" ? parsed.reason : null;

      safeRecordFaceMetricEvent({
        source: "server",
        sessionId,
        status:
          status === "found" || status === "unknown" || status === "error"
            ? status
            : null,
        reason,
        serverProcessingMs,
        gatewayUpstreamMs,
      });

      const responsePayload: Record<string, unknown> = {
        ...parsed,
        gateway_upstream_ms: roundMetric(gatewayUpstreamMs),
      };
      if (serverProcessingMs !== null) {
        responsePayload.server_processing_ms = roundMetric(serverProcessingMs);
      }

      return NextResponse.json(responsePayload, { status: upstream.status });
    } catch {
      return new NextResponse(bodyText, {
        status: upstream.status,
        headers: { "Content-Type": contentType },
      });
    }
  } catch (error) {
    const gatewayUpstreamMs = Date.now() - requestStartedAt;
    safeRecordFaceMetricEvent({
      source: "server",
      sessionId,
      status: "error",
      reason: "proxy_error",
      gatewayUpstreamMs,
    });

    const message =
      error instanceof Error ? error.message : "Unexpected proxy error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
