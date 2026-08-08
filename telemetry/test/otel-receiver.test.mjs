// telemetry/test/otel-receiver.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { dataFileFor } from '../otel-receiver.mjs';

const RECEIVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'otel-receiver.mjs');
const PORT = 43180 + (process.pid % 100); // avoid the real 4318 and cross-run collision
const DATA_DIR = mkdtempSync(join(tmpdir(), 'otel-test-'));
let child;
// NOTE (cold-review C1): importing dataFileFor from otel-receiver.mjs is safe ONLY because
// the module guards its listen() behind a main-module check — without the guard this import
// binds the real port (hanging the runner) or exits the runner green on EADDRINUSE.

const METRICS_BODY = JSON.stringify({
  resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: 'claude_code.cost.usage', sum: { dataPoints: [{ timeUnixNano: '1754612400000000000', asDouble: 0.5, attributes: [{ key: 'session.id', value: { stringValue: 'sess-2' } }] }] } }] }] }],
});

async function post(path, body, headers = {}) {
  return fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
}

async function waitForListen() {
  for (let i = 0; i < 50; i += 1) {
    try { await fetch(`http://127.0.0.1:${PORT}/`, { method: 'GET' }); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('receiver never listened');
}

before(async () => {
  child = spawn(process.execPath, [RECEIVER], { env: { ...process.env, OTEL_RECEIVER_PORT: String(PORT), OTEL_RECEIVER_DATA_DIR: DATA_DIR }, stdio: 'ignore' });
  await waitForListen();
});
after(() => {
  child.kill();
  rmSync(DATA_DIR, { recursive: true, force: true });
});

test('dataFileFor names the monthly file from the date', () => {
  assert.equal(dataFileFor(new Date('2026-08-07T12:00:00Z'), '/x'), join('/x', '2026-08.ndjson'));
  assert.equal(dataFileFor(new Date('2026-01-02T12:00:00Z'), '/x'), join('/x', '2026-01.ndjson'));
});

test('POST /v1/metrics appends a row', async () => {
  const res = await post('/v1/metrics', METRICS_BODY);
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 200));
  const file = dataFileFor(new Date(), DATA_DIR);
  assert.ok(existsSync(file));
  const rows = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.at(-1).name, 'claude_code.cost.usage');
  assert.equal(rows.at(-1).sid, 'sess-2');
});

test('gzip body is accepted', async () => {
  const res = await post('/v1/metrics', gzipSync(METRICS_BODY), { 'content-encoding': 'gzip' });
  assert.equal(res.status, 200);
});

test('malformed JSON returns 400, server survives', async () => {
  const res = await post('/v1/logs', '{not json');
  assert.equal(res.status, 400);
  const again = await post('/v1/metrics', METRICS_BODY);
  assert.equal(again.status, 200);
});

test('unknown route returns 404', async () => {
  const res = await post('/v1/traces', '{}');
  assert.equal(res.status, 404);
});
