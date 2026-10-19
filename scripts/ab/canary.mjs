#!/usr/bin/env node
// canary.mjs: zero-cost proof of what an arm's session loads (#271).
//
//   node scripts/ab/canary.mjs --arm <bare|current> [--ticket <id>] [--plant-memory] [--out <dir>] [--keep]
//
// Builds a real round for the ticket (round.mjs: same checkout, home, config, harness and barrier as
// a live run), then runs the round's own claude command for one turn with the API pointed at a local
// stub: ANTHROPIC_BASE_URL is the stub, ANTHROPIC_API_KEY an invalid key (a request that escaped the
// stub would be refused, unbilled), HTTP(S)_PROXY a closed local port (nothing else leaves the
// machine). The stub records each Messages request, which is where Claude Code puts CLAUDE.md and
// auto-memory, and answers "ok". No model runs. The key and the stub replace auth for that turn, so
// the session never holds the token; `claude auth status` in the round, with the user's
// CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`, set in their env; required, as for a live
// round, and never written anywhere), covers auth. No login is copied. However the canary ends, a
// round that fails to build included, the round dir is removed (--keep retains it and prints its
// Remove-Item line).
//
// Markers: the harness root CLAUDE.md's first line; a nonce CLAUDE.md written into the checkout (a
// repo-level CLAUDE.md, the kind a repo of its own carries); the first entry of the user's real memory
// index; with --plant-memory, a nonce MEMORY.md planted in the round's own memory dir for the checkout,
// the positive control that loaded memory would be seen. Memory counts as loaded only when a MEMORY.md's
// contents reach the request, not when the memory instructions do. The verdict:
//   bare             PASS when no CLAUDE.md, no memory file and no marker reached the request
//   current          PASS when the harness root CLAUDE.md did, and no memory file did
// and in every case only when `claude auth status` in the round reports loggedIn.
//   --plant-memory   PASS when the planted memory did (bare: when it did not)
// Exit 0 PASS, 1 FAIL, 2 INCONCLUSIVE (no request reached the stub). <out>/canary-<arm>/requests.jsonl
// holds CLAUDE.md and memory text, so keep it local. It does not cover a nested CLAUDE.md that loads
// when a tool reads a subdirectory: that needs a tool call, which this one-turn stub never makes.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { die, isMain, log, parseArgs, workspaceRoot } from '../lib.mjs';
import { ARMS, CANARY_COMMAND, DEFAULT_OUT, claudeCommand, loadManifest, planRound, projectKey, tokenHelp } from './ab-lib.mjs';
import { prepareRound, realClaudePaths, releaseRound, runClaude } from './round.mjs';

const AB_DIR = dirname(fileURLToPath(import.meta.url));

/** Every string inside a parsed request body, joined: CLAUDE.md can sit in system or in a message. */
function strings(v, acc = []) {
  if (typeof v === 'string') acc.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, acc);
  return acc;
}

/** What the captured request bodies show was loaded: CLAUDE.md and MEMORY.md files whose contents
 *  were included, and which `markers` ({name: text}) appear. */
export function analyzeRequests(bodies, markers) {
  const text = bodies
    .map((b) => {
      try {
        return strings(JSON.parse(b)).join('\n');
      } catch {
        return b;
      }
    })
    .join('\n');
  const files = (re) => [...new Set([...text.matchAll(re)].map((m) => m[1]))];
  return {
    requests: bodies.length,
    claudeMdFiles: files(/Contents of ([^\n]*?CLAUDE(?:\.local)?\.md)/g),
    memoryFiles: files(/Contents of ([^\n]*?MEMORY\.md)/g),
    markers: Object.fromEntries(Object.entries(markers).map(([k, v]) => [k, text.includes(v)])),
  };
}

const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function reply(model, stream) {
  const usage = { input_tokens: 1, output_tokens: 1 };
  if (!stream) return { id: 'msg_ab_canary', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage };
  return [
    sse('message_start', { type: 'message_start', message: { id: 'msg_ab_canary', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage } }),
    sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }),
    sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
    sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }),
    sse('message_stop', { type: 'message_stop' }),
  ].join('');
}

/** A local Messages API stub on 127.0.0.1. Records each POST /v1/messages body; past `cap` requests it
 *  answers 400, so a looping session (a Stop hook that keeps blocking) ends. → {url, bodies, close}. */
export function startStub({ cap = 20 } = {}) {
  const bodies = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0];
      if (req.method !== 'POST' || path !== '/v1/messages') {
        res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: path } }));
        return;
      }
      if (bodies.length >= cap) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'ab canary: request cap reached' } }));
        return;
      }
      bodies.push(raw);
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        // an unparseable body still counts as a request that reached the stub
      }
      const out = reply(body.model ?? 'stub', body.stream === true);
      if (typeof out === 'string') res.writeHead(200, { 'content-type': 'text/event-stream' }).end(out);
      else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, bodies, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/** The first entry line of the user's real memory index for the workspace, if there is one. */
function realMemoryLine(workspace) {
  const index = join(realClaudePaths().config, 'projects', projectKey(workspace), 'memory', 'MEMORY.md');
  return existsSync(index) ? readFileSync(index, 'utf8').split(/\r?\n/).find((l) => l.startsWith('- ')) : null;
}

if (isMain(import.meta.url)) await main().catch((e) => die(e.message));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!ARMS.includes(args.arm)) die(`--arm must be one of ${ARMS.join(', ')}`);
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) die(tokenHelp(CANARY_COMMAND));
  const arm = args.arm;
  const plant = Boolean(args['plant-memory']);
  const out = join(args.out || DEFAULT_OUT, `canary-${arm}${plant ? '-planted' : ''}`);
  const workspace = workspaceRoot();
  const manifest = loadManifest(join(AB_DIR, 'manifest.json'));
  const ticket = manifest.tickets.find((t) => t.id === (args.ticket || 'claude-config-240'));
  if (!ticket) die(`unknown ticket ${args.ticket}`);
  const plan = planRound(manifest, ticket, arm, 1, { tmp: tmpdir(), workspace, out, roundId: `canary-${randomBytes(4).toString('hex')}` }, []);
  let verdict;
  // However the canary ends, a round that fails to build included, the round dir is removed (--keep names it for removal).
  try {
    verdict = await probe(plan, { arm, plant, out, workspace });
  } finally {
    await releaseRound(plan.layout.root, Boolean(args.keep));
  }
  process.exit(verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : 2);
}

/** Build the round, run its claude command for one turn against the stub, and judge what loaded. → the verdict. */
async function probe(plan, { arm, plant, out, workspace }) {
  const l = plan.layout;
  const { env: roundEnv, prompt } = prepareRound(plan, { workspace });

  const nonce = randomBytes(6).toString('hex');
  writeFileSync(join(l.checkout, 'CLAUDE.md'), `# Probe\n\nAB-CANARY-PROJECT-${nonce}\n`);
  const markers = { project: `AB-CANARY-PROJECT-${nonce}` };
  // current: the harness root CLAUDE.md in the round; bare: the user's real one, which must not load.
  const root = arm === 'current' ? join(l.code, 'CLAUDE.md') : join(workspace, 'CLAUDE.md');
  if (existsSync(root)) markers.root = readFileSync(root, 'utf8').split(/\r?\n/).find((x) => x.trim());
  const realMemory = realMemoryLine(workspace);
  if (realMemory) markers.realMemory = realMemory;
  if (plant) {
    markers.planted = `AB-CANARY-MEMORY-${nonce}`;
    const dir = join(l.config, 'projects', projectKey(l.checkout), 'memory');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'MEMORY.md'), `- [Probe](probe.md) - ${markers.planted}\n`);
  }

  // Auth as a live round does it, with no model turn: the part the stub replaces.
  const cmd = claudeCommand();
  const auth = spawnSync(cmd[0], [...cmd.slice(1), 'auth', 'status'], { cwd: l.checkout, env: { ...roundEnv, CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN }, encoding: 'utf8' });
  const loggedIn = /"loggedIn":\s*true/.test(auth.stdout ?? '');

  const stub = await startStub();
  const deadProxy = 'http://127.0.0.1:9';
  const env = {
    ...roundEnv,
    ANTHROPIC_BASE_URL: stub.url,
    ANTHROPIC_API_KEY: 'sk-ant-api03-ab-canary-invalid-key',
    HTTPS_PROXY: deadProxy,
    HTTP_PROXY: deadProxy,
    NO_PROXY: '127.0.0.1,localhost',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  log(`canary ${arm}${plant ? ' (planted memory)' : ''}: ${l.root}\n  $ ${[...cmd, ...plan.claude.args].join(' ')} (API -> ${stub.url})`);
  let r;
  try {
    r = await runClaude(cmd, plan.claude.args, { cwd: l.checkout, env, input: prompt, timeoutMs: 180_000 });
  } finally {
    await stub.close();
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'requests.jsonl'), stub.bodies.map((b) => b.replace(/\r?\n/g, ' ')).join('\n'));
  writeFileSync(join(out, 'claude.out.txt'), `${r.stdout}\n--- stderr ---\n${r.stderr}`);

  const a = analyzeRequests(stub.bodies, markers);
  const m = a.markers;
  const noMemory = a.memoryFiles.length === 0 && !m.realMemory && !m.planted;
  let ok;
  if (plant) ok = arm === 'current' ? m.planted : !m.planted && a.memoryFiles.length === 0;
  else if (arm === 'bare') ok = a.claudeMdFiles.length === 0 && noMemory && !m.project && !m.root;
  else ok = m.root && noMemory;
  const verdict = a.requests === 0 ? 'INCONCLUSIVE' : ok && loggedIn ? 'PASS' : 'FAIL';
  log(JSON.stringify({ arm, plant, loggedIn, claudeExit: r.status, ...a }, null, 2));
  log(`${verdict} (requests in ${join(out, 'requests.jsonl')})`);
  return verdict;
}
