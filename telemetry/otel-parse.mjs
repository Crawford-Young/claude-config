// telemetry/otel-parse.mjs — OTLP http/json -> flat NDJSON rows (schema v1, see telemetry/README.md)
const MAX_ATTR_LENGTH = 256;
const KEPT_METRICS = new Set([
  'claude_code.token.usage',
  'claude_code.cost.usage',
  'claude_code.session.count',
]);

export function decodeValue(value) {
  if (!value || typeof value !== 'object') return undefined;
  if ('stringValue' in value) return String(value.stringValue);
  if ('intValue' in value) return Number(value.intValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('boolValue' in value) return Boolean(value.boolValue);
  return undefined;
}

export function flattenAttrs(attrList) {
  const flat = {};
  for (const entry of attrList ?? []) {
    const decoded = decodeValue(entry?.value);
    if (decoded === undefined || !entry?.key) continue;
    flat[entry.key] = typeof decoded === 'string' ? decoded.slice(0, MAX_ATTR_LENGTH) : decoded;
  }
  return flat;
}

function nanoToIso(timeUnixNano) {
  if (!timeUnixNano) return new Date().toISOString();
  return new Date(Number(BigInt(timeUnixNano) / 1000000n)).toISOString();
}

function makeRow(kind, name, ts, val, attrs) {
  const { 'session.id': sid, ...rest } = attrs;
  return { v: 1, ts, sid, kind, name, val, attrs: rest };
}

export function parseMetricsPayload(payload) {
  const rows = [];
  for (const rm of payload?.resourceMetrics ?? []) {
    for (const sm of rm?.scopeMetrics ?? []) {
      for (const metric of sm?.metrics ?? []) {
        if (!KEPT_METRICS.has(metric?.name)) continue;
        const agg = metric?.sum?.aggregationTemporality; // OTLP enum: 1=delta, 2=cumulative
        const dataPoints = metric?.sum?.dataPoints ?? metric?.gauge?.dataPoints ?? [];
        for (const dp of dataPoints) {
          const val = dp?.asDouble ?? (dp?.asInt !== undefined ? Number(dp.asInt) : undefined);
          if (val === undefined) continue;
          const row = makeRow('metric', metric.name, nanoToIso(dp.timeUnixNano), val, flattenAttrs(dp.attributes));
          if (agg !== undefined) row.agg = agg;
          if (dp.startTimeUnixNano) row.st = nanoToIso(dp.startTimeUnixNano);
          rows.push(row);
        }
      }
    }
  }
  return rows;
}

export function parseLogsPayload(payload) {
  const rows = [];
  for (const rl of payload?.resourceLogs ?? []) {
    for (const sl of rl?.scopeLogs ?? []) {
      for (const rec of sl?.logRecords ?? []) {
        if (!rec || typeof rec !== 'object') continue;
        const attrs = flattenAttrs(rec.attributes);
        const name = rec.eventName ?? attrs['event.name'] ?? 'unknown_event';
        delete attrs['event.name'];
        rows.push(makeRow('event', name, nanoToIso(rec.timeUnixNano), 1, attrs));
      }
    }
  }
  return rows;
}
