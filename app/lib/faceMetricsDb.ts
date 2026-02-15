import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type MetricEventSource = "server" | "client";
export type MetricEventStatus = "found" | "unknown" | "error";

type MetricStatSummary = {
  avg: number | null;
  min: number | null;
  max: number | null;
  last: number | null;
};

type ResolvedMetricsWindow = {
  mode: "today" | "custom";
  from: string;
  to: string;
  sqlFrom: string;
  sqlTo: string;
};

type SessionGroupedMetrics = {
  window: {
    from: string;
    to: string;
    mode: "today" | "custom";
  };
  session_summary: {
    total_sessions: number;
    successful_sessions: number;
    failed_sessions: number;
    success_rate: number;
    avg_attempts_until_success: number | null;
    p50_first_success_time_ms: number | null;
    p90_first_success_time_ms: number | null;
    avg_attempt_latency_per_session_ms: number | null;
  };
  sessions: Array<{
    session_id: string;
    started_at: string;
    ended_at: string;
    attempt_count: number;
    success: boolean;
    attempts_until_success: number | null;
    first_success_at: string | null;
    first_success_time_ms: number | null;
    avg_server_processing_ms: number | null;
    avg_gateway_upstream_ms: number | null;
    avg_client_rtt_ms: number | null;
    avg_network_latency_ms_est: number | null;
    final_status: string | null;
    final_reason: string | null;
  }>;
};

type InsertMetricEventInput = {
  source: MetricEventSource;
  sessionId?: string | null;
  status?: MetricEventStatus | null;
  reason?: string | null;
  serverProcessingMs?: number | null;
  gatewayUpstreamMs?: number | null;
  clientRttMs?: number | null;
  networkLatencyMsEst?: number | null;
};

function defaultDbPath(): string {
  const envPath = process.env.METRICS_DB_PATH?.trim();
  if (envPath) return envPath;
  if (process.env.NODE_ENV === "production") return "/data/metrics.db";
  return path.join(process.cwd(), ".data", "metrics.db");
}

function normalizeMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value >= 0 ? value : null;
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toMetricStatSummary(row: unknown): MetricStatSummary {
  const mapped = (row ?? {}) as Record<string, number | null | undefined>;
  return {
    avg: normalizeMs(mapped.avg ?? null),
    min: normalizeMs(mapped.min ?? null),
    max: normalizeMs(mapped.max ?? null),
    last: normalizeMs(mapped.last ?? null),
  };
}

function toSqliteUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const hours = `${date.getUTCHours()}`.padStart(2, "0");
  const minutes = `${date.getUTCMinutes()}`.padStart(2, "0");
  const seconds = `${date.getUTCSeconds()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function parseDateInput(value: string): Date | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function parseSqliteUtc(value: string): Date | null {
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const METRIC_COLUMNS = new Set([
  "server_processing_ms",
  "gateway_upstream_ms",
  "client_rtt_ms",
  "network_latency_ms_est",
]);

class FaceMetricsDb {
  private db: DatabaseSync;

  constructor() {
    const filePath = defaultDbPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS identify_metrics_events (
        id INTEGER PRIMARY KEY,
        created_at TEXT NOT NULL,
        session_id TEXT NULL,
        source TEXT NOT NULL,
        status TEXT NULL,
        reason TEXT NULL,
        server_processing_ms REAL NULL,
        gateway_upstream_ms REAL NULL,
        client_rtt_ms REAL NULL,
        network_latency_ms_est REAL NULL
      );

      CREATE INDEX IF NOT EXISTS idx_identify_metrics_created_at
      ON identify_metrics_events(created_at);

      CREATE INDEX IF NOT EXISTS idx_identify_metrics_session_id
      ON identify_metrics_events(session_id);

      CREATE INDEX IF NOT EXISTS idx_identify_metrics_source
      ON identify_metrics_events(source);

      CREATE INDEX IF NOT EXISTS idx_identify_metrics_status_reason
      ON identify_metrics_events(status, reason);
    `);
  }

  insertEvent(input: InsertMetricEventInput): void {
    this.db
      .prepare(
        `INSERT INTO identify_metrics_events (
          created_at,
          session_id,
          source,
          status,
          reason,
          server_processing_ms,
          gateway_upstream_ms,
          client_rtt_ms,
          network_latency_ms_est
        ) VALUES (
          datetime('now'),
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )`
      )
      .run(
        normalizeText(input.sessionId),
        input.source,
        normalizeText(input.status ?? null),
        normalizeText(input.reason ?? null),
        normalizeMs(input.serverProcessingMs),
        normalizeMs(input.gatewayUpstreamMs),
        normalizeMs(input.clientRttMs),
        normalizeMs(input.networkLatencyMsEst)
      );
    this.pruneOldRows();
  }

  getRequestCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM identify_metrics_events WHERE source = 'server'")
      .get() as { count?: number };
    return Number(row?.count ?? 0);
  }

  getMetricStats(column: string): MetricStatSummary {
    if (!METRIC_COLUMNS.has(column)) {
      throw new Error(`Unsupported metric column: ${column}`);
    }
    const row = this.db
      .prepare(
        `SELECT
          AVG(${column}) AS avg,
          MIN(${column}) AS min,
          MAX(${column}) AS max,
          (
            SELECT ${column}
            FROM identify_metrics_events
            WHERE ${column} IS NOT NULL
            ORDER BY id DESC
            LIMIT 1
          ) AS last
        FROM identify_metrics_events
        WHERE ${column} IS NOT NULL`
      )
      .get();
    return toMetricStatSummary(row);
  }

  getStatusReasonCounts(): Array<{ status: string; reason: string; count: number }> {
    const rows = this.db
      .prepare(
        `SELECT
          COALESCE(status, 'unknown') AS status,
          COALESCE(reason, 'unknown') AS reason,
          COUNT(*) AS count
        FROM identify_metrics_events
        WHERE source = 'server'
        GROUP BY status, reason
        ORDER BY count DESC`
      )
      .all() as Array<{ status: string; reason: string; count: number }>;
    return rows.map((row) => ({
      status: row.status,
      reason: row.reason,
      count: Number(row.count ?? 0),
    }));
  }

  getSessionGroupedMetrics(window: ResolvedMetricsWindow): SessionGroupedMetrics {
    type ServerRow = {
      id: number;
      session_id: string;
      created_at: string;
      status: string | null;
      reason: string | null;
      server_processing_ms: number | null;
      gateway_upstream_ms: number | null;
    };

    const serverRows = this.db
      .prepare(
        `SELECT
          id,
          session_id,
          created_at,
          status,
          reason,
          server_processing_ms,
          gateway_upstream_ms
        FROM identify_metrics_events
        WHERE source = 'server'
          AND session_id IS NOT NULL
          AND TRIM(session_id) <> ''
          AND created_at >= ?
          AND created_at <= ?
        ORDER BY session_id ASC, id ASC`
      )
      .all(window.sqlFrom, window.sqlTo) as ServerRow[];

    const clientRows = this.db
      .prepare(
        `SELECT
          session_id,
          AVG(client_rtt_ms) AS avg_client_rtt_ms,
          AVG(network_latency_ms_est) AS avg_network_latency_ms_est
        FROM identify_metrics_events
        WHERE source = 'client'
          AND session_id IS NOT NULL
          AND TRIM(session_id) <> ''
          AND created_at >= ?
          AND created_at <= ?
        GROUP BY session_id`
      )
      .all(window.sqlFrom, window.sqlTo) as Array<{
      session_id: string;
      avg_client_rtt_ms: number | null;
      avg_network_latency_ms_est: number | null;
    }>;

    const clientStatsBySession = new Map(
      clientRows.map((row) => [
        row.session_id,
        {
          avg_client_rtt_ms: normalizeMs(row.avg_client_rtt_ms),
          avg_network_latency_ms_est: normalizeMs(row.avg_network_latency_ms_est),
        },
      ])
    );

    const sessionMap = new Map<
      string,
      {
        session_id: string;
        started_at: string;
        ended_at: string;
        attempt_count: number;
        success: boolean;
        attempts_until_success: number | null;
        first_success_at: string | null;
        first_success_time_ms: number | null;
        avg_server_processing_ms: number | null;
        avg_gateway_upstream_ms: number | null;
        avg_client_rtt_ms: number | null;
        avg_network_latency_ms_est: number | null;
        final_status: string | null;
        final_reason: string | null;
        _server_sum: number;
        _server_count: number;
        _gateway_sum: number;
        _gateway_count: number;
      }
    >();

    for (const row of serverRows) {
      let session = sessionMap.get(row.session_id);
      if (!session) {
        session = {
          session_id: row.session_id,
          started_at: row.created_at,
          ended_at: row.created_at,
          attempt_count: 0,
          success: false,
          attempts_until_success: null,
          first_success_at: null,
          first_success_time_ms: null,
          avg_server_processing_ms: null,
          avg_gateway_upstream_ms: null,
          avg_client_rtt_ms: null,
          avg_network_latency_ms_est: null,
          final_status: null,
          final_reason: null,
          _server_sum: 0,
          _server_count: 0,
          _gateway_sum: 0,
          _gateway_count: 0,
        };
        sessionMap.set(row.session_id, session);
      }

      session.attempt_count += 1;
      session.ended_at = row.created_at;
      session.final_status = row.status;
      session.final_reason = row.reason;

      if (row.server_processing_ms !== null && Number.isFinite(row.server_processing_ms)) {
        session._server_sum += row.server_processing_ms;
        session._server_count += 1;
      }
      if (row.gateway_upstream_ms !== null && Number.isFinite(row.gateway_upstream_ms)) {
        session._gateway_sum += row.gateway_upstream_ms;
        session._gateway_count += 1;
      }

      if (!session.success && row.status === "found") {
        session.success = true;
        session.attempts_until_success = session.attempt_count;
        session.first_success_at = row.created_at;
        const startedAt = parseSqliteUtc(session.started_at);
        const firstSuccessAt = parseSqliteUtc(row.created_at);
        if (startedAt && firstSuccessAt) {
          session.first_success_time_ms = Math.max(
            0,
            firstSuccessAt.getTime() - startedAt.getTime()
          );
        }
      }
    }

    const sessions = Array.from(sessionMap.values()).map((session) => {
      const clientStats = clientStatsBySession.get(session.session_id);
      return {
        session_id: session.session_id,
        started_at: session.started_at,
        ended_at: session.ended_at,
        attempt_count: session.attempt_count,
        success: session.success,
        attempts_until_success: session.attempts_until_success,
        first_success_at: session.first_success_at,
        first_success_time_ms: roundMetric(session.first_success_time_ms),
        avg_server_processing_ms:
          session._server_count > 0 ? roundMetric(session._server_sum / session._server_count) : null,
        avg_gateway_upstream_ms:
          session._gateway_count > 0
            ? roundMetric(session._gateway_sum / session._gateway_count)
            : null,
        avg_client_rtt_ms: roundMetric(clientStats?.avg_client_rtt_ms ?? null),
        avg_network_latency_ms_est: roundMetric(
          clientStats?.avg_network_latency_ms_est ?? null
        ),
        final_status: session.final_status,
        final_reason: session.final_reason,
      };
    });

    sessions.sort((a, b) => b.started_at.localeCompare(a.started_at));

    const successfulSessions = sessions.filter((session) => session.success);
    const firstSuccessValues = successfulSessions
      .map((session) => session.first_success_time_ms)
      .filter((v): v is number => typeof v === "number");
    const attemptsUntilSuccessValues = successfulSessions
      .map((session) => session.attempts_until_success)
      .filter((v): v is number => typeof v === "number");
    const sessionAttemptLatencyValues = sessions
      .map((session) => session.avg_server_processing_ms)
      .filter((v): v is number => typeof v === "number");

    const totalSessions = sessions.length;
    const successCount = successfulSessions.length;

    const avgAttemptsUntilSuccess =
      attemptsUntilSuccessValues.length > 0
        ? attemptsUntilSuccessValues.reduce((acc, v) => acc + v, 0) /
          attemptsUntilSuccessValues.length
        : null;

    const avgAttemptLatencyPerSession =
      sessionAttemptLatencyValues.length > 0
        ? sessionAttemptLatencyValues.reduce((acc, v) => acc + v, 0) /
          sessionAttemptLatencyValues.length
        : null;

    const successRate = totalSessions > 0 ? successCount / totalSessions : 0;

    return {
      window: {
        from: window.from,
        to: window.to,
        mode: window.mode,
      },
      session_summary: {
        total_sessions: totalSessions,
        successful_sessions: successCount,
        failed_sessions: totalSessions - successCount,
        success_rate: Math.round(successRate * 10_000) / 10_000,
        avg_attempts_until_success: roundMetric(avgAttemptsUntilSuccess),
        p50_first_success_time_ms: roundMetric(percentile(firstSuccessValues, 50)),
        p90_first_success_time_ms: roundMetric(percentile(firstSuccessValues, 90)),
        avg_attempt_latency_per_session_ms: roundMetric(avgAttemptLatencyPerSession),
      },
      sessions,
    };
  }

  private pruneOldRows(): void {
    this.db
      .prepare(
        "DELETE FROM identify_metrics_events WHERE created_at < datetime('now', '-30 days')"
      )
      .run();
  }
}

let singleton: FaceMetricsDb | null = null;

function getDb(): FaceMetricsDb {
  if (!singleton) {
    singleton = new FaceMetricsDb();
  }
  return singleton;
}

function roundMetric(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export function recordFaceMetricEvent(input: InsertMetricEventInput): void {
  getDb().insertEvent(input);
}

export function resolveFaceMetricsWindow(input?: {
  from?: string | null;
  to?: string | null;
}): { ok: true; value: ResolvedMetricsWindow } | { ok: false; error: string } {
  const fromRaw = input?.from?.trim() ?? "";
  const toRaw = input?.to?.trim() ?? "";

  if ((fromRaw && !toRaw) || (!fromRaw && toRaw)) {
    return {
      ok: false,
      error: "Both 'from' and 'to' must be provided together for a custom range.",
    };
  }

  if (!fromRaw && !toRaw) {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    return {
      ok: true,
      value: {
        mode: "today",
        from: startOfToday.toISOString(),
        to: now.toISOString(),
        sqlFrom: toSqliteUtc(startOfToday),
        sqlTo: toSqliteUtc(now),
      },
    };
  }

  const fromDate = parseDateInput(fromRaw);
  const toDate = parseDateInput(toRaw);
  if (!fromDate || !toDate) {
    return { ok: false, error: "Invalid date format. Use ISO datetime for 'from' and 'to'." };
  }
  if (fromDate.getTime() >= toDate.getTime()) {
    return { ok: false, error: "'from' must be earlier than 'to'." };
  }

  return {
    ok: true,
    value: {
      mode: "custom",
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      sqlFrom: toSqliteUtc(fromDate),
      sqlTo: toSqliteUtc(toDate),
    },
  };
}

export function getFaceMetricsSummary(window?: ResolvedMetricsWindow) {
  const db = getDb();
  const serverStats = db.getMetricStats("server_processing_ms");
  const gatewayStats = db.getMetricStats("gateway_upstream_ms");
  const clientStats = db.getMetricStats("client_rtt_ms");
  const networkStats = db.getMetricStats("network_latency_ms_est");

  const resolvedWindow = (() => {
    if (window) return window;
    const fallback = resolveFaceMetricsWindow();
    if (!fallback.ok) {
      throw new Error(fallback.error);
    }
    return fallback.value;
  })();

  return {
    request_count: db.getRequestCount(),
    avg_server_processing_ms: roundMetric(serverStats.avg),
    avg_client_rtt_ms: roundMetric(clientStats.avg),
    avg_gateway_upstream_ms: roundMetric(gatewayStats.avg),
    avg_network_latency_ms_est: roundMetric(networkStats.avg),
    server_processing_ms: {
      min: roundMetric(serverStats.min),
      max: roundMetric(serverStats.max),
      last: roundMetric(serverStats.last),
    },
    client_rtt_ms: {
      min: roundMetric(clientStats.min),
      max: roundMetric(clientStats.max),
      last: roundMetric(clientStats.last),
    },
    gateway_upstream_ms: {
      min: roundMetric(gatewayStats.min),
      max: roundMetric(gatewayStats.max),
      last: roundMetric(gatewayStats.last),
    },
    network_latency_ms_est: {
      min: roundMetric(networkStats.min),
      max: roundMetric(networkStats.max),
      last: roundMetric(networkStats.last),
    },
    status_reason_counts: db.getStatusReasonCounts(),
    grouped: db.getSessionGroupedMetrics(resolvedWindow),
  };
}
