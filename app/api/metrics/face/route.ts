import { NextResponse } from "next/server";
import { getFaceMetricsSummary, resolveFaceMetricsWindow } from "@/app/lib/faceMetricsDb";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const resolvedWindow = resolveFaceMetricsWindow({ from, to });
    if (!resolvedWindow.ok) {
      return NextResponse.json({ error: resolvedWindow.error }, { status: 400 });
    }

    return NextResponse.json(getFaceMetricsSummary(resolvedWindow.value));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected metrics read error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
