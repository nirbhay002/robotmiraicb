import { NextResponse } from "next/server";
import { recordFaceMetricEvent } from "@/app/lib/faceMetricsDb";

export const runtime = "nodejs";

function asOptionalNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function asOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as Record<string, unknown>;
    const sessionId = asOptionalText(payload.session_id) ?? req.headers.get("x-session-id");
    const clientRttMs = asOptionalNumber(payload.client_rtt_ms);
    if (clientRttMs === null) {
      return NextResponse.json(
        { error: "client_rtt_ms must be a non-negative number" },
        { status: 400 }
      );
    }

    const statusRaw = asOptionalText(payload.status);
    const status =
      statusRaw === "found" || statusRaw === "unknown" || statusRaw === "error"
        ? statusRaw
        : null;
    const reason = asOptionalText(payload.reason);
    const serverProcessingMs = asOptionalNumber(payload.server_processing_ms);
    const gatewayUpstreamMs = asOptionalNumber(payload.gateway_upstream_ms);
    const networkLatencyMsEst =
      serverProcessingMs === null ? null : Math.max(0, clientRttMs - serverProcessingMs);

    recordFaceMetricEvent({
      source: "client",
      sessionId,
      status,
      reason,
      serverProcessingMs,
      gatewayUpstreamMs,
      clientRttMs,
      networkLatencyMsEst,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected metrics ingest error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
