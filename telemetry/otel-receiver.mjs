// telemetry/otel-receiver.mjs — local OTLP http/json receiver for Claude Code usage capture.
// Spawned by hooks/otel-receiver-spawn.ps1 (SessionStart). Single instance via port bind.
// Data: ~/.claude/otel/YYYY-MM.ndjson (schema v1 — telemetry/README.md). Fail-open by design.
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { parseMetricsPayload, parseLogsPayload } from './otel-parse.mjs';

const PORT = Number(process.env.OTEL_RECEIVER_PORT ?? 4318);
const DATA_DIR = process.env.OTEL_RECEIVER_DATA_DIR ?? path.join(os.homedir(), '.claude', 'otel');
const ERROR_LOG = path.join(DATA_DIR, 'receiver-errors.log');

export function dataFileFor(date, dir) {
  const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return path.join(dir, `${month}.ndjson`);
}

function logError(message) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch { /* fail-open: nowhere left to report */ }
}

function appendRows(rows) {
  if (rows.length === 0) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const lines = rows.map((row) => `${JSON.stringify(row)}\n`).join('');
  fs.appendFileSync(dataFileFor(new Date(), DATA_DIR), lines);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'gzip') {
        zlib.gunzip(raw, (err, out) => (err ? reject(err) : resolve(out)));
      } else {
        resolve(raw);
      }
    });
  });
}

const ROUTES = { '/v1/metrics': parseMetricsPayload, '/v1/logs': parseLogsPayload };

const server = http.createServer(async (req, res) => {
  const parse = req.method === 'POST' ? ROUTES[req.url] : undefined;
  if (!parse) {
    res.writeHead(404).end();
    return;
  }
  let rows;
  try {
    const body = await readBody(req);
    rows = parse(JSON.parse(body.toString('utf8')));
  } catch (err) {
    logError(`${req.url}: ${err.message}`);
    res.writeHead(400).end();
    return;
  }
  try {
    appendRows(rows);
  } catch (err) {
    logError(`write ${req.url}: ${err.message}`); // swallowed after one log attempt — never surface a disk problem to the exporter
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
});

// Listen ONLY when run as the main module (cold-review C1): the test file imports
// dataFileFor from here, and an import-time listen either hangs the test runner
// (port free) or process.exit(0)s it mid-suite on EADDRINUSE (receiver already up).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') process.exit(0); // another instance is serving — by design
    logError(`server error: ${err.message}`);
    process.exit(1);
  });
  process.on('uncaughtException', (err) => logError(`uncaught: ${err.message}`));
  server.listen(PORT, '127.0.0.1');
}
