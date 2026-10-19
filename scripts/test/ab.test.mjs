// node --test scripts/test/ab.test.mjs
// #271 A/B runner, pure parts: manifest, round layout and env, settings for an arm, the estimate,
// the blind anonymizer and packets, the isolation canary's analysis and stub. The live path is in ab-run.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnHarness, tempDir } from './_spawn.mjs';
import {
  ARMS,
  addedLines,
  ancestorClaudeMds,
  barrierEnv,
  checkoutSteps,
  childEnv,
  claudeArgs,
  doneWhen,
  estimateRound,
  gateVerdict,
  gitconfigEntries,
  loadManifest,
  parseClaudeJson,
  parseManifest,
  planRound,
  projectKey,
  promptFrom,
  pruneClaudeJson,
  roundLayout,
  scanContamination,
  selectRounds,
  transcriptParts,
  transformSettings,
} from '../ab/ab-lib.mjs';
import { anonymize, dropFiles, leaks, pathVariants } from '../ab/anonymize.mjs';
import { blindId, buildPacket, exclusionReason, gradeTemplate } from '../ab/grade.mjs';
import { TOKEN_PLACEHOLDER, redactSecret } from '../ab/round.mjs';
import { analyzeRequests, startStub } from '../ab/canary.mjs';

const AB = join(dirname(fileURLToPath(import.meta.url)), '..', 'ab');
const MANIFEST = join(AB, 'manifest.json');

const SHA = 'a'.repeat(40);
const ticket = (over = {}) => ({
  id: 'demo-1',
  path: 'claude-config',
  issue: 1,
  kind: 'bug',
  title: 't',
  pr: 2,
  merge: 'b'.repeat(40),
  parent: SHA,
  harness: SHA,
  lines: 100,
  why: 'w',
  gates: [{ name: 'test', cmd: 'node --test' }],
  body: '## Done when\n- [ ] it works\n',
  ...over,
});
const manifestText = (tickets, over = {}) =>
  JSON.stringify({
    issue: 'o/r#1',
    owner: 'o',
    model: 'claude-opus-5-5',
    effort: 'high',
    permissionMode: 'auto',
    runsPerArm: 2,
    prior: { usdPerRun: 10, turnsPerRun: 40, source: 's' },
    tickets,
    ...over,
  });
const WHERE = { tmp: 'C:\\T', workspace: 'C:\\Users\\u\\code', out: 'C:\\O', roundId: 'r1d' };

// ---- manifest ----------------------------------------------------------------------

test('the committed manifest holds the 10-ticket harness-only set: full SHAs, the harness at the parent, a prompt file each', () => {
  const m = loadManifest(MANIFEST);
  assert.equal(m.tickets.length, 10);
  for (const t of m.tickets) {
    // Round 5 (user, 2026-10-16): the A/B is harness only.
    assert.equal(t.path, 'claude-config', t.id);
    for (const k of ['parent', 'merge', 'harness']) assert.match(t[k], /^[0-9a-f]{40}$/, `${t.id} ${k}`);
    assert.equal(t.harness, t.parent, t.id);
    assert.ok(t.body.length > 100, `${t.id} has an issue body`);
    assert.ok(doneWhen(t.body).length >= 1, `${t.id} has at least one Done-when box`);
    for (const k of ['setup', 'inline', 'seed']) assert.equal(t[k], undefined, `${t.id} carries no product-ticket ${k}`);
  }
  const parent = (id) => m.tickets.find((t) => t.id === id)?.parent;
  // Round 2 swap (director, 2026-10-16): claude-config#216's PR also fixed #217.
  assert.equal(parent('claude-config-193'), '246611065f65983dd62b6b89d4707b06b83daa6a');
  assert.equal(parent('claude-config-216'), undefined);
  for (const gone of ['dog-eat-dog-13', 'strate-10', 'strate-30']) assert.equal(parent(gone), undefined, gone);
  // Round 5 additions: each PR is one rebased commit, so the parent is merge~1.
  assert.equal(parent('claude-config-129'), 'c06963573106d68aca935f89404f5866ed8f57ef');
  assert.equal(parent('claude-config-178'), '230e7c19322ab2cb29fe626fb23c68d57a8aa76a');
  assert.equal(parent('claude-config-124'), '47107d632f66c89227c9a155ef738417fde8efbb');
  assert.deepEqual(new Set(m.tickets.map((t) => t.kind)), new Set(['bug', 'debt', 'feat', 'test']));
});

test('claude-config-124 prompts with its original body, not the edit that mirrors the fix commit (user, 2026-10-19)', () => {
  const t = loadManifest(MANIFEST).tickets.find((x) => x.id === 'claude-config-124');
  assert.deepEqual(doneWhen(t.body), [
    'verify-frontmatter prints the listed-description bytes for ~/.claude/skills/synced and ~/.claude/plugins/synced (report only, no cap)',
    'Test covers the measurement with a fixture dir',
  ]);
  assert.doesNotMatch(t.body, /~g2|disable-model-invocation|--synced-plugins|not present/, 'no implementation choice from the 03:26Z edit');
});

test('parseManifest rejects short SHAs, duplicate ids, missing gates, a bad gate pattern, a non-harness ticket and an unsafe permission mode', () => {
  assert.throws(() => parseManifest(manifestText([ticket({ parent: 'abc123' })])), /demo-1: parent must be a 40-char SHA/);
  assert.throws(() => parseManifest(manifestText([ticket({ harness: undefined })])), /demo-1: harness must be a 40-char SHA/);
  assert.throws(() => parseManifest(manifestText([ticket(), ticket()])), /duplicate ticket id demo-1/);
  assert.throws(() => parseManifest(manifestText([ticket({ gates: [] })])), /demo-1: gates must list at least one/);
  assert.throws(() => parseManifest(manifestText([ticket({ gates: [{ name: 't', cmd: 'x', failIf: '(' }] })])), /demo-1: gate t failIf is not a regex/);
  assert.throws(() => parseManifest(manifestText([ticket({ path: 'apps/strate' })])), /demo-1: path must be claude-config \(the A\/B is harness only\)/);
  assert.throws(() => parseManifest(manifestText([ticket()], { permissionMode: 'bypassPermissions' })), /permissionMode/);
  assert.throws(() => parseManifest('{nope'), /manifest is not JSON/);
  assert.equal(parseManifest(manifestText([ticket()])).tickets[0].id, 'demo-1');
});

// ---- prompt and Done-when --------------------------------------------------------------

test('promptFrom gives the issue body with LF endings and every box unchecked', () => {
  assert.equal(promptFrom('## Done when\r\n- [x] a\r\n- [X] b\r\n- [ ] c\r\n\r\n'), '## Done when\n- [ ] a\n- [ ] b\n- [ ] c\n');
});

test('doneWhen reads the boxes under the Done when heading and stops at the next heading', () => {
  const body = '## Goal\n- [ ] not this\n## Done when\n- [ ] one\n  wrapped\n- [x] two\n\n## Out of scope\n- [ ] not this either\n';
  assert.deepEqual(doneWhen(body), ['one wrapped', 'two']);
});

test('doneWhen falls back to an inline **Done when:** line when there are no boxes', () => {
  assert.deepEqual(doneWhen('Intro.\n\n**Done when:** claude-config#81 groups across its sessions.\n\nSpec: x'), ['claude-config#81 groups across its sessions.']);
  assert.deepEqual(doneWhen('no criteria here'), []);
});

// ---- round layout and isolation ------------------------------------------------------------

test('both arms get the same arm-free layout under <tmp>/ab/<round id>, with the checkout where a worktree would sit', () => {
  const l = roundLayout(ticket(), 'r1d', WHERE);
  const root = join('C:\\T', 'ab', 'r1d');
  assert.deepEqual(l, {
    root,
    code: join(root, 'code'),
    checkout: join(root, 'code', '.worktrees', 'claude-config-1'),
    harness: join(root, 'code', 'claude-config'),
    config: join(root, '.claude'),
    gh: join(root, '.config', 'gh'),
    gitconfig: join(root, '.gitconfig'),
    appData: join(root, 'AppData', 'Roaming'),
    localAppData: join(root, 'AppData', 'Local'),
    tmp: join(root, 'tmp'),
  });
  assert.throws(() => roundLayout(ticket(), 'r1d', { ...WHERE, tmp: 'C:\\Users\\u\\code\\tmp' }), /inside the workspace/);
});

test('ancestorClaudeMds finds a CLAUDE.md in any directory above the checkout, never the checkout itself', () => {
  const root = tempDir('ab-anc-');
  const co = join(root, 'a', 'b', 'co');
  mkdirSync(co, { recursive: true });
  writeFileSync(join(co, 'CLAUDE.md'), 'repo-level');
  assert.deepEqual(ancestorClaudeMds(co), []);
  writeFileSync(join(root, 'a', 'CLAUDE.md'), 'ancestor');
  mkdirSync(join(root, 'a', 'b', '.claude'));
  writeFileSync(join(root, 'a', 'b', '.claude', 'CLAUDE.md'), 'ancestor dot-claude');
  assert.deepEqual(ancestorClaudeMds(co).sort(), [join(root, 'a', 'CLAUDE.md'), join(root, 'a', 'b', '.claude', 'CLAUDE.md')].sort());
});

test('barrierEnv points home, temp, config, gh and git at the round, and sets nothing else', () => {
  const l = roundLayout(ticket(), 'r1d', WHERE);
  const e = barrierEnv(l);
  assert.equal(e.HOME, l.root);
  // The real %TEMP% holds other sessions' scratch dirs; the round gets its own.
  for (const k of ['TEMP', 'TMP', 'TMPDIR']) assert.equal(e[k], join(l.root, 'tmp'), k);
  assert.equal(e.USERPROFILE, l.root);
  // Windows code finds the home through these as well (HOMEDRIVE+HOMEPATH, the AppData pair), not HOME alone.
  assert.equal(`${e.HOMEDRIVE}${e.HOMEPATH}`, l.root);
  assert.equal(e.HOMEDRIVE, 'C:');
  assert.equal(e.APPDATA, join(l.root, 'AppData', 'Roaming'));
  assert.equal(e.LOCALAPPDATA, join(l.root, 'AppData', 'Local'));
  assert.deepEqual([l.appData, l.localAppData], [e.APPDATA, e.LOCALAPPDATA]);
  assert.equal(e.CLAUDE_CONFIG_DIR, l.config);
  assert.equal(e.GH_CONFIG_DIR, l.gh);
  assert.equal(e.GIT_CONFIG_GLOBAL, l.gitconfig);
  assert.equal(e.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(e.GIT_TERMINAL_PROMPT, '0');
  // Rust and Bun tool homes went with the product tickets (round 5).
  assert.deepEqual(Object.keys(e).filter((k) => /CARGO|RUSTUP|BUN/.test(k)), []);
});

test('gitconfigEntries reads `git config --list -z`, drops every credential key, blocks every network transport and keeps file', () => {
  assert.deepEqual(gitconfigEntries('core.autocrlf\ntrue\0credential.helper\nmanager\0credential.https://github.com.helper\n!gh auth git-credential\0filter.lfs.smudge\ngit-lfs smudge -- %f\0'), [
    ['core.autocrlf', 'true'],
    ['filter.lfs.smudge', 'git-lfs smudge -- %f'],
    ['protocol.allow', 'never'],
    // claude-config's own tests clone local repos (land, worktree); without file every one is red at the parent.
    ['protocol.file.allow', 'always'],
  ]);
});

test('transformSettings: current runs the harness checkout hooks, bare runs none; both lose live-only wiring and get deny rules', () => {
  const live = 'C:/Users/u/code/claude-config';
  const settings = {
    model: 'opus',
    statusLine: { type: 'command', command: `node ${live}/statusline/statusline.mjs` },
    enabledPlugins: { x: true },
    permissions: { deny: ['Bash(git add -A:*)'] },
    hooks: {
      PermissionRequest: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:1/hooks' }] }],
      Notification: [{ hooks: [{ type: 'command', command: 'powershell', args: [`${live}/hooks/toast.ps1`] }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: [`${live}/hooks/session-start.mjs`] }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'node', args: [`C:\\Users\\u\\code\\claude-config\\hooks\\gone.mjs`] }] }],
    },
  };
  const opts = { liveHarness: 'C:\\Users\\u\\code\\claude-config', harnessDir: 'C:\\R\\code\\claude-config', denyRoots: ['C:\\Users\\u\\code', 'C:\\Users\\u\\.claude'], exists: (p) => !p.includes('gone') };
  const cur = transformSettings(settings, { ...opts, arm: 'current' });
  assert.deepEqual(cur.hooks, { SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: ['C:/R/code/claude-config/hooks/session-start.mjs'] }] }] });
  assert.equal(cur.statusLine, undefined);
  assert.equal(cur.enabledPlugins, undefined);
  assert.equal(cur.model, 'opus');
  assert.deepEqual(cur.permissions.deny, ['Bash(git add -A:*)', 'Read(//c/Users/u/code/**)', 'Edit(//c/Users/u/code/**)', 'Read(//c/Users/u/.claude/**)', 'Edit(//c/Users/u/.claude/**)']);
  const bare = transformSettings(settings, { ...opts, arm: 'bare' });
  assert.equal(bare.hooks, undefined);
  assert.deepEqual(bare.permissions, cur.permissions);
  assert.ok(settings.hooks.Stop, 'the input is not mutated');
});

test('pruneClaudeJson keeps the account and drops per-project history and usage', () => {
  assert.deepEqual(pruneClaudeJson({ oauthAccount: { a: 1 }, userID: 'u', projects: { x: {} }, githubRepoPaths: {}, skillUsage: {}, agentLastUsed: {}, mcpServers: {} }), { oauthAccount: { a: 1 }, userID: 'u' });
});

test('projectKey is the transcript folder name Claude Code derives from a cwd', () => {
  assert.equal(projectKey('C:\\Users\\young\\code\\.worktrees\\ab-x'), 'C--Users-young-code--worktrees-ab-x');
});

// ---- the claude command and env ---------------------------------------------------------------

test('the two arms run the same command except that bare adds --safe-mode', () => {
  const opts = { model: 'claude-opus-5-5', effort: 'high', permissionMode: 'auto', budgetUsd: 20 };
  const current = claudeArgs('current', opts);
  const bare = claudeArgs('bare', opts);
  assert.deepEqual(bare, ['--safe-mode', ...current]);
  for (const [flag, value] of [['--model', 'claude-opus-5-5'], ['--output-format', 'json'], ['--effort', 'high'], ['--permission-mode', 'auto'], ['--permission-prompts', 'none'], ['--max-budget-usd', '20']]) {
    assert.equal(current[current.indexOf(flag) + 1], value, flag);
  }
  assert.ok(current.includes('-p'));
  assert.throws(() => claudeArgs('other', opts), /arm must be one of bare, current/);
});

test('childEnv drops the launching session identity, the OAuth token and every GitHub token, and keeps config dir and PATH', () => {
  const env = childEnv(
    { PATH: 'p', CLAUDECODE: '1', CLAUDE_PID: '9', CLAUDE_EFFORT: 'max', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CODE_SAFE_MODE: '1', CLAUDE_CONFIG_DIR: 'c', CLAUDE_CODE_OAUTH_TOKEN: 't', ANTHROPIC_API_KEY: 'k', GH_TOKEN: 'g', GITHUB_TOKEN: 'g', GH_ENTERPRISE_TOKEN: 'g', GITHUB_ENTERPRISE_TOKEN: 'g' },
    { CARGO_TARGET_DIR: 'x' },
  );
  // The token goes to claude alone; the gates run model-written code.
  assert.deepEqual(env, { PATH: 'p', CLAUDE_CONFIG_DIR: 'c', ANTHROPIC_API_KEY: 'k', CARGO_TARGET_DIR: 'x' });
});

test('redactSecret replaces a secret in every file under a dir, binary-safe, and counts the files it rewrote', () => {
  const d = tempDir('ab-redact-');
  mkdirSync(join(d, 'sub'), { recursive: true });
  writeFileSync(join(d, 'a.log'), 'x TOKEN-123 y TOKEN-123\n');
  writeFileSync(join(d, 'sub', 's.jsonl'), Buffer.from([0xff, 0x00, ...Buffer.from('"TOKEN-123"'), 0xfe]));
  writeFileSync(join(d, 'clean.txt'), 'nothing\n');
  assert.equal(redactSecret(d, 'TOKEN-123'), 2);
  assert.equal(readFileSync(join(d, 'a.log'), 'utf8'), `x ${TOKEN_PLACEHOLDER} y ${TOKEN_PLACEHOLDER}\n`);
  assert.deepEqual([...readFileSync(join(d, 'sub', 's.jsonl'))], [0xff, 0x00, ...Buffer.from(`"${TOKEN_PLACEHOLDER}"`), 0xfe]);
  assert.equal(redactSecret(d, 'TOKEN-123'), 0);
  assert.equal(redactSecret(join(d, 'missing'), 'TOKEN-123'), 0);
});

test('parseClaudeJson reads cost, turns and duration from --output-format json, and flags unreadable output', () => {
  const ok = parseClaudeJson(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1200, num_turns: 7, total_cost_usd: 1.5, session_id: 'x', result: 'done' }));
  assert.deepEqual(ok, { ok: true, subtype: 'success', isError: false, costUsd: 1.5, turns: 7, durationMs: 1200, sessionId: 'x', result: 'done' });
  const bad = parseClaudeJson('Error: boom');
  assert.equal(bad.ok, false);
  assert.equal(bad.costUsd, null);
});

test('gateVerdict fails a green exit whose output trips failIf or lacks requireMatch, as CI does', () => {
  assert.deepEqual(gateVerdict({ name: 't', cmd: 'x' }, 0, ''), { rc: 0, reason: null });
  assert.deepEqual(gateVerdict({ name: 't', cmd: 'x' }, 2, ''), { rc: 2, reason: null });
  assert.deepEqual(gateVerdict({ name: 't', cmd: 'x', failIf: 'could not find script' }, 0, 'a\nERR could not find script b'), { rc: 1, reason: 'output matches failIf /could not find script/' });
  assert.deepEqual(gateVerdict({ name: 't', cmd: 'x', requireMatch: '^ℹ tests [1-9]' }, 0, 'ℹ tests 0'), { rc: 1, reason: 'output lacks requireMatch /^ℹ tests [1-9]/' });
  assert.deepEqual(gateVerdict({ name: 't', cmd: 'x', requireMatch: '^ℹ tests [1-9]' }, 0, 'x\nℹ tests 12'), { rc: 0, reason: null });
});

const SCAN_ROOTS = [{ path: 'C:\\Users\\u\\code', label: 'workspace' }, { path: 'C:\\Users\\u\\.claude', label: 'config' }, { path: 'C:\\Users\\u\\AppData\\Local\\Temp', label: 'temp' }, { path: 'C:\\Nope', label: 'nope' }];

test('scanContamination counts each real-path spelling each source reached, the double-escaped jsonl one included, with the paths it saw', () => {
  const transcripts = 'cat C:\\Users\\u\\code\\claude-config\\x and /c/Users/u/code/docs/y and C:\\\\Users\\\\u\\\\.claude\\\\z';
  // A Bash command quoted inside a JSON string inside jsonl: four backslashes per separator.
  const nested = '{"input":"{\\"command\\":\\"type C:\\\\\\\\Users\\\\\\\\u\\\\\\\\code\\\\\\\\x\\"}"}';
  assert.deepEqual(scanContamination({ transcripts, 'gate-test.log': 'ok', nested }, SCAN_ROOTS), {
    flagged: [
      { source: 'transcripts', label: 'workspace', count: 2, paths: ['C:\\Users\\u\\code\\claude-config\\x', '/c/Users/u/code/docs/y'] },
      { source: 'transcripts', label: 'config', count: 1, paths: ['C:\\Users\\u\\.claude\\z'] },
      { source: 'nested', label: 'workspace', count: 1, paths: ['C:\\Users\\u\\code\\x'] },
    ],
    explained: [],
  });
});

// Representative lines of the 7 files that spell the user's paths at every parent (66 hits each,
// probe-falseflags, round 5): live hook wiring, a PowerShell comment, escaped JS test fixtures, a JSON fixture.
const TREE_FILES = {
  'hooks/README.md': '  "Stop": [ { "hooks": [{ "type": "command", "command": "node", "args": ["C:/Users/u/code/claude-config/hooks/bash-guard.mjs"] }] } ],\n',
  'scripts/import-harness.ps1': '    # Claude keys project memory by path: C:\\Users\\u\\code -> C--Users-u-code\n',
  'scripts/test/audit-lib.test.mjs': "  const read = { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'C:\\\\Users\\\\u\\\\code\\\\docs\\\\web\\\\TESTING-TRAPS.md' } };\n",
  'statusline/tests/fixtures/full.json': '{"session_id":"4e","transcript_path":"C:\\\\Users\\\\u\\\\.claude\\\\projects\\\\C--Users-u-code\\\\4e.jsonl"}\n',
};
/** treeExplains' semantics (git grep -F): the string occurs somewhere in a tree file. */
const treeSpells = (s) => Object.values(TREE_FILES).some((f) => f.includes(s));
/** One Claude Code transcript line: an assistant tool call, or the user turn carrying its result. */
const toolCall = (name, input) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name, input }] } });
const toolResult = (content, extra = {}) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content }] }, ...extra });
/** A transcript scanned as run.mjs scans it: tool-call inputs are what the session wrote. */
const scanTranscript = (jsonl, opts = {}) => {
  const { inputs, served } = transcriptParts(jsonl);
  return scanContamination({ transcripts: served, 'tool inputs': inputs }, SCAN_ROOTS, { explains: treeSpells, written: ['tool inputs'], ...opts });
};

test('transcriptParts puts every tool_use input, wherever a line records it, in inputs, and the rest in served', () => {
  const blob = JSON.stringify({ type: 'api-request-blob', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'IN-BLOB' } }] } });
  const nested = JSON.stringify({ type: 'progress', data: { message: { message: { content: [{ type: 'server_tool_use', name: 'x', input: { q: 'IN-SUBAGENT' } }] } } } });
  const jsonl = [toolCall('Bash', { command: 'IN-CALL' }), toolResult('SERVED-RESULT', { toolUseResult: { stdout: 'SERVED-STDOUT' } }), blob, nested, '{"type":"attachment","attachment":{"content":"SERVED-NOTE"}}', '{not json IN-BROKEN', ''].join('\n');
  const { inputs, served } = transcriptParts(jsonl);
  for (const s of ['IN-CALL', 'IN-BLOB', 'IN-SUBAGENT', 'IN-BROKEN']) {
    assert.match(inputs, new RegExp(s), s);
    assert.doesNotMatch(served, new RegExp(s), s);
  }
  for (const s of ['SERVED-RESULT', 'SERVED-STDOUT', 'SERVED-NOTE']) {
    assert.match(served, new RegExp(s), s);
    assert.doesNotMatch(inputs, new RegExp(s), s);
  }
  // An input keeps its JSON escaping, as in the jsonl: one spelling set covers both parts.
  assert.match(transcriptParts(toolCall('Bash', { command: 'type C:\\x' })).inputs, /type C:\\\\x/);
});

test('scanContamination: each probe-m2 reach into the live repo flags, though the round tree spells its path (round-5 review, Major A)', () => {
  const reaches = [
    ['Bash', { command: 'cd C:/Users/u/code/claude-config && git show 246611065f65 --stat' }],
    ['Bash', { command: 'git -C /c/Users/u/code/claude-config log main -p' }],
    ['Bash', { command: 'ls C:\\Users\\u\\code' }],
    ['Bash', { command: 'cat C:/Users/u/code/claude-config/scripts/ab/manifest.json' }],
    ['Read', { file_path: 'C:\\Users\\u\\code\\claude-config\\hooks\\bash-guard.mjs' }],
    ['Bash', { command: 'git -C C:/Users/u/code/claude-config/ show main:hooks/bash-guard.mjs' }],
    ['Bash', { command: 'cat C:/Users/u/code/claude-config/hooks/bash-guard.mjs' }],
  ];
  // The premise of the regression: the tree spells the paths of reaches 1, 3, 6 and 7, so substring explaining hid them.
  for (const p of ['C:/Users/u/code/claude-config', 'C:\\Users\\u\\code', 'C:/Users/u/code/claude-config/', 'C:/Users/u/code/claude-config/hooks/bash-guard.mjs']) assert.ok(treeSpells(p), p);
  for (const [name, input] of reaches) {
    const scan = scanTranscript(`${toolCall(name, input)}\n${toolResult('ok')}`);
    assert.deepEqual(scan.flagged.map(({ source, label, count }) => [source, label, count]), [['tool inputs', 'workspace', 1]], JSON.stringify(input));
    assert.deepEqual(scan.explained, [], JSON.stringify(input));
  }
});

test('scanContamination: tree-spelled paths the round served (tool results, raw gate output) stay explained (probe-falseflags, 66 of 66)', () => {
  const read = Object.entries(TREE_FILES).flatMap(([file, text]) => [
    toolCall('Read', { file_path: file }),
    toolResult(text.split('\n').map((l, i) => `${String(i + 1).padStart(6)}\u2192${l}`).join('\n'), { toolUseResult: { type: 'text', file: { filePath: file, content: text } } }),
  ]);
  const scan = scanContamination(
    { ...(({ inputs, served }) => ({ transcripts: served, 'tool inputs': inputs }))(transcriptParts(read.join('\n'))), 'gate-test.log': Object.values(TREE_FILES).join('') },
    SCAN_ROOTS,
    { explains: treeSpells, written: ['tool inputs'] },
  );
  assert.deepEqual(scan.flagged, []);
  assert.deepEqual(scan.explained.map(({ source, label, count }) => [source, label, count]), [
    ['transcripts', 'workspace', 6],
    ['transcripts', 'config', 2],
    ['gate-test.log', 'workspace', 3],
    ['gate-test.log', 'config', 1],
  ]);
  // A genuine reach in a tool result still flags: the real transcript store, a path no round file holds.
  assert.deepEqual(scanTranscript(toolResult('C:\\Users\\u\\.claude\\projects\\real\\t.jsonl')).flagged, [{ source: 'transcripts', label: 'config', count: 1, paths: ['C:\\Users\\u\\.claude\\projects\\real\\t.jsonl'] }]);
});

test("scanContamination knows git-bash's /tmp, which is the real temp whatever TEMP the round sets: a path under it flags, the round's own alias is masked", () => {
  const tmp = 'C:\\Users\\u\\AppData\\Local\\Temp';
  const opts = { mask: [`${tmp}\\ab\\r1d`], tmp };
  const jsonl = [
    toolCall('Bash', { command: 'ls /tmp/claude/other-session && cd /tmp && cat "/tmp/ab/r2e/code/x" && pwd' }),
    toolResult('/tmp/ab/r1d/code/.worktrees/claude-config-1'),
    toolCall('Bash', { command: 'TMPDIR=/tmp/claude node x.mjs; cat x/tmp/y /tmp-relative /tmpfile; echo $TEMP' }),
    toolResult('a\nb\n/tmp/claude/z/notes.md'),
    // Claude Code's own environment note names bare /tmp; that reaches nothing.
    '{"type":"attachment","attachment":{"type":"environment","content":"use it instead of `/tmp` or other system temp directories"}}',
  ].join('\n');
  assert.deepEqual(scanTranscript(jsonl, opts), {
    flagged: [
      { source: 'transcripts', label: 'temp', count: 1, paths: ['/tmp/claude/z/notes.md'] },
      { source: 'tool inputs', label: 'temp', count: 4, paths: ['/tmp/claude/other-session', '/tmp', '/tmp/ab/r2e/code/x', '/tmp/claude'] },
    ],
    explained: [{ source: 'transcripts', label: 'temp', count: 1, paths: ['/tmp'] }],
  });
});

test('scanContamination masks the round itself, which sits under the real temp dir, and still flags another temp path', () => {
  const round = 'C:\\Users\\u\\AppData\\Local\\Temp\\ab\\r1d';
  const log = 'cwd C:\\Users\\u\\AppData\\Local\\Temp\\ab\\r1d\\code and /c/Users/u/AppData/Local/Temp/ab/r1d/tmp/x and C:\\\\Users\\\\u\\\\AppData\\\\Local\\\\Temp\\\\ab\\\\r1d\n'
    + 'type C:\\Users\\u\\AppData\\Local\\Temp\\claude\\other-session\\notes.md';
  assert.deepEqual(scanContamination({ 'gate-test.log': log }, SCAN_ROOTS, { mask: [round] }).flagged, [
    { source: 'gate-test.log', label: 'temp', count: 1, paths: ['C:\\Users\\u\\AppData\\Local\\Temp\\claude\\other-session\\notes.md'] },
  ]);
});

test('addedLines keeps the lines a diff adds, read hunk by hunk, so context is skipped and an added "++" line is kept', () => {
  const diff = [
    'diff --git a/r.md b/r.md', '--- a/r.md', '+++ b/r.md', '@@ -1,2 +1,4 @@', ' see C:\\Users\\u\\code', '-old', '+new C:/Users/u/.claude', '+++x counter',
    '+two', 'diff --git a/s.md b/s.md', 'new file mode 100644', '--- /dev/null', '+++ b/s.md', '@@ -0,0 +1 @@', '+one', '\\ No newline at end of file',
    'diff --git a/b.bin b/b.bin', 'GIT binary patch', 'literal 3', 'Hc$@<O00001', '',
  ].join('\n');
  assert.equal(addedLines(diff), '+new C:/Users/u/.claude\n+++x counter\n+two\n+one');
});

// ---- round selection, plan and estimate -----------------------------------------------------

test('selectRounds narrows by --only, --arm and --run, and names a bad value', () => {
  const m = parseManifest(manifestText([ticket(), ticket({ id: 'demo-2' })]));
  assert.equal(selectRounds(m, {}).length, 8);
  assert.deepEqual(selectRounds(m, { only: 'demo-2', arm: 'bare', run: '2' }).map((r) => [r.ticket.id, r.arm, r.run]), [['demo-2', 'bare', 2]]);
  assert.throws(() => selectRounds(m, { only: 'nope' }), /unknown ticket nope/);
  assert.throws(() => selectRounds(m, { arm: 'x' }), /arm must be one of bare, current/);
  assert.throws(() => selectRounds(m, { run: '3' }), /run must be 1\.\.2/);
  assert.deepEqual(ARMS, ['bare', 'current']);
});

test('estimateRound scales the prior by size, then prefers measured runs of the ticket, then other measured runs', () => {
  const m = parseManifest(manifestText([ticket({ id: 's', lines: 50 }), ticket({ id: 'm', lines: 100 }), ticket({ id: 'l', lines: 150 })]));
  const [s, mid, l] = m.tickets;
  assert.deepEqual(estimateRound(mid, m, []), { usd: 10, turns: 40, basis: 'prior (s), size factor 1 of mean 1' });
  assert.equal(estimateRound(s, m, []).usd, 5);
  assert.equal(estimateRound(l, m, []).usd, 15);
  const skew = parseManifest(manifestText([ticket({ id: 'a', lines: 100 }), ticket({ id: 'b', lines: 100 }), ticket({ id: 'c', lines: 10000 })]));
  assert.deepEqual(skew.tickets.map((t) => estimateRound(t, skew, []).usd), [5, 5, 20]);
  const measured = [{ ticketId: 'm', costUsd: 6, turns: 30 }, { ticketId: 'm', costUsd: 8, turns: 20 }];
  assert.deepEqual(estimateRound(mid, m, measured), { usd: 8, turns: 30, basis: 'max of 2 measured run(s) of this ticket' });
  assert.deepEqual(estimateRound(s, m, measured), { usd: 3.5, turns: 13, basis: 'scaled from 2 measured run(s), size factor 0.5' });
});

test('planRound fetches only the parent into a fresh repo, and both arms share every path and the prompt', () => {
  const m = parseManifest(manifestText([ticket()]));
  const p = planRound(m, m.tickets[0], 'bare', 1, WHERE, []);
  assert.equal(p.layout.checkout, join('C:\\T', 'ab', 'r1d', 'code', '.worktrees', 'claude-config-1'));
  assert.equal(p.resultsDir, join('C:\\O', 'runs', 'demo-1', 'bare-r1'));
  assert.equal(p.source, join(WHERE.workspace, 'claude-config'));
  assert.equal(p.harnessSource, join(WHERE.workspace, 'claude-config'));
  const co = p.layout.checkout;
  assert.deepEqual(p.fetch, [
    ['git', 'init', '--quiet', co],
    ['git', '-C', co, 'fetch', '--quiet', '--no-tags', p.source, SHA],
    ['git', '-C', co, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'],
  ]);
  // One source of truth: the dry run prints the steps fetchCheckout runs.
  assert.deepEqual(p.fetch, checkoutSteps(p.source, SHA, co));
  assert.ok(!p.fetch.flat().includes('clone'), 'a clone would copy main, which holds the fix');
  for (const k of ['prompt', 'setup', 'inline', 'seed']) assert.equal(p[k], undefined, k);
  assert.equal(p.claude.args[0], '--safe-mode');
  assert.equal(p.claude.args[p.claude.args.indexOf('--max-budget-usd') + 1], '20', 'the cap is twice the estimate');
  const cur = planRound(m, m.tickets[0], 'current', 1, WHERE, []);
  assert.deepEqual(cur.claude.args, p.claude.args.slice(1));
  assert.deepEqual(cur.layout, p.layout);
});

test('run.mjs --dry-run prints each round with its commands and estimate, and touches nothing', () => {
  const home = tempDir('ab-home-');
  const out = join(home, 'out');
  const r = spawnHarness(join(AB, 'run.mjs'), ['--dry-run', '--only', 'claude-config-220', '--out', out], { home, env: { CLAUDE_CODE_OAUTH_TOKEN: '', TEMP: join(home, 't'), TMP: join(home, 't'), TMPDIR: join(home, 't') } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /claude-config-220 bare r1/);
  assert.match(r.stdout, /claude-config-220 current r2/);
  assert.match(r.stdout, /est\. \$[\d.]+, ~\d+ turns/);
  assert.match(r.stdout, /--safe-mode -p --model claude-opus-5-5/);
  assert.match(r.stdout, /fetch --quiet --no-tags \S+ 8a7f289c6ee314eea26541ec41de4d326608fdfd/);
  assert.match(r.stdout, /harness: claude-config at 8a7f289c6ee314eea26541ec41de4d326608fdfd/);
  assert.match(r.stdout, /node --test "scripts\/test\/\*\.test\.mjs"/);
  assert.match(r.stdout, /total: 4 round\(s\), est\. \$/);
  assert.match(r.stdout, /CLAUDE_CODE_OAUTH_TOKEN is not set: a live round will refuse to start\./);
  assert.match(r.stdout, /\$env:CLAUDE_CODE_OAUTH_TOKEN = Read-Host; node scripts\/ab\/run\.mjs --only <ticket> --arm <bare\|current> --run <n>/);
  assert.match(r.stdout, /not as a persistent user env var/);
  assert.match(r.stdout, /HOMEDRIVE\+HOMEPATH, APPDATA, LOCALAPPDATA, TEMP, TMP and TMPDIR/);
  assert.match(r.stdout, /the round dir is removed after capture \(--keep retains it\)/);
  assert.doesNotMatch(r.stdout, /LFS|setup\)|inlined/, 'product-ticket steps are gone');
  assert.equal(existsSync(out), false, 'a dry run writes nothing');
  assert.equal(existsSync(join(home, 't', 'ab')), false);
  const withToken = spawnHarness(join(AB, 'run.mjs'), ['--dry-run', '--only', 'claude-config-129', '--arm', 'bare', '--run', '1', '--out', out], { home, env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-DRYRUN' } });
  assert.equal(withToken.status, 0, withToken.stderr);
  assert.match(withToken.stdout, /auth:\s+CLAUDE_CODE_OAUTH_TOKEN from your env, to claude only/);
  assert.doesNotMatch(withToken.stdout, /is not set/);
  assert.doesNotMatch(`${withToken.stdout}${withToken.stderr}`, /DRYRUN/, 'the token value is never printed');
});

test('run.mjs refuses a live run that is not narrowed to exactly one round', () => {
  const r = spawnHarness(join(AB, 'run.mjs'), ['--only', 'claude-config-220']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /a live run takes exactly one round: --only <ticket> --arm <bare\|current> --run <n>/);
});

test('run.mjs and canary.mjs refuse to start without CLAUDE_CODE_OAUTH_TOKEN, and never fall back to copying the login', () => {
  const home = tempDir('ab-notoken-');
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude', '.credentials.json'), '{"claudeAiOauth":{}}');
  const env = { CLAUDE_CODE_OAUTH_TOKEN: '', TEMP: join(home, 't'), TMP: join(home, 't'), TMPDIR: join(home, 't') };
  const run = spawnHarness(join(AB, 'run.mjs'), ['--only', 'claude-config-220', '--arm', 'bare', '--run', '1', '--out', join(home, 'out')], { home, env });
  const canary = spawnHarness(join(AB, 'canary.mjs'), ['--arm', 'bare', '--out', join(home, 'out')], { home, env });
  for (const [name, r, cmd] of [['run', run, 'run\\.mjs --only <ticket>'], ['canary', canary, 'canary\\.mjs --arm <bare\\|current>']]) {
    assert.notEqual(r.status, 0, name);
    assert.match(r.stderr, /needs CLAUDE_CODE_OAUTH_TOKEN\. Create one once with `claude setup-token`/, name);
    assert.match(r.stderr, new RegExp(`\\$env:CLAUDE_CODE_OAUTH_TOKEN = Read-Host; node scripts/ab/${cmd}`), name);
    assert.match(r.stderr, /every Claude Code session would run on that token/, name);
  }
  assert.equal(existsSync(join(home, 'out')), false, 'nothing written');
  assert.equal(existsSync(join(home, 't', 'ab')), false, 'no round built');
});

// ---- anonymizer ------------------------------------------------------------------------

const ROUND = 'C:\\Users\\Young\\AppData\\Local\\Temp\\ab\\9f3c2a1b';
const CTX = {
  tmp: 'C:\\Users\\Young\\AppData\\Local\\Temp',
  roots: [
    { path: `${ROUND}\\code\\.worktrees\\claude-config-129`, label: '<repo>' },
    { path: ROUND, label: '<home>' },
    { path: 'C:\\Users\\Young\\AppData\\Local\\Temp', label: '<local>' },
    { path: 'C:\\Users\\Young\\code', label: '<local>' },
    { path: 'C:\\Users\\Young', label: '<local>' },
  ],
};

test('pathVariants covers JSON-escaped, backslash, forward-slash, git-bash, the /tmp alias and the project key', () => {
  assert.deepEqual(pathVariants('C:\\Users\\Y\\x'), ['C:\\\\Users\\\\Y\\\\x', 'C:\\Users\\Y\\x', 'C:/Users/Y/x', '/c/Users/Y/x', 'C--Users-Y-x']);
  assert.ok(pathVariants('C:\\T\\ab\\r1', 'C:\\T').includes('/tmp/ab/r1'));
  assert.ok(!pathVariants('C:\\T', 'C:\\T').includes('/tmp'), 'the temp dir itself is not aliased, or every /tmp in a diff would go');
});

test('anonymize replaces the checkout and local paths in every spelling, case-insensitively', () => {
  const raw = [
    `at ${ROUND}\\code\\.worktrees\\claude-config-129\\scripts\\lib.mjs:3`,
    'at c:/users/young/appdata/local/temp/ab/9f3c2a1b/code/.worktrees/claude-config-129/scripts/lib.mjs',
    'cd /c/Users/Young/AppData/Local/Temp/ab/9f3c2a1b/code/.worktrees/claude-config-129 && ls',
    'cd /tmp/ab/9f3c2a1b/code/.worktrees/claude-config-129/scripts',
    '"cwd":"C:\\\\Users\\\\Young\\\\AppData\\\\Local\\\\Temp\\\\ab\\\\9f3c2a1b\\\\code\\\\.worktrees\\\\claude-config-129"',
    'fixture projects/C--Users-Young-AppData-Local-Temp-ab-9f3c2a1b-code--worktrees-claude-config-129/s.jsonl',
    'wrote C:\\Users\\Young\\AppData\\Local\\Temp\\other.txt and C:/Users/Young/code/CLAUDE.md',
  ].join('\n');
  const out = anonymize(raw, CTX);
  assert.equal(
    out,
    ['at <repo>\\scripts\\lib.mjs:3', 'at <repo>/scripts/lib.mjs', 'cd <repo> && ls', 'cd <repo>/scripts', '"cwd":"<repo>"', 'fixture projects/<repo>/s.jsonl', 'wrote <local>\\other.txt and <local>/CLAUDE.md'].join('\n'),
  );
  assert.deepEqual(leaks(out, CTX), []);
});

test('anonymize redacts safe-mode and arm labels with one shared placeholder, and leaves harness file names (the repo holds them)', () => {
  const raw = 'CLAUDE_CODE_SAFE_MODE=1 claude --safe-mode; safe mode on\nsee x-current-r2 and x-bare-r1\nper skills/qa/SKILL.md and CLAUDE.md';
  const out = anonymize(raw, CTX);
  assert.equal(out, '<redacted> claude <redacted>; <redacted> on\nsee x-<arm>-r2 and x-<arm>-r1\nper skills/qa/SKILL.md and CLAUDE.md');
  assert.deepEqual(leaks(out, CTX), []);
});

test('dropFiles removes harness-workflow files such as COMMIT_MSG_<n>.txt from a diff', () => {
  const diff = 'diff --git a/a.ts b/a.ts\n+x\ndiff --git a/COMMIT_MSG_9.txt b/COMMIT_MSG_9.txt\nnew file mode 100644\n+What: y\ndiff --git a/sub/commit_msg.txt b/sub/commit_msg.txt\n+z\n';
  assert.equal(dropFiles(diff), 'diff --git a/a.ts b/a.ts\n+x\n');
});

test('leaks names every identifying pattern left in unanonymized text, commit-body vocabulary included', () => {
  const found = leaks('C:/Users/Young/AppData/Local/Temp/ab/x-bare-r1 --safe-mode\n+Verified: node x -> rc 0', CTX).map((l) => l.pattern);
  for (const p of ['<local>', 'temp path', 'safe-mode', 'arm label', 'commit-body vocabulary']) assert.ok(found.includes(p), p);
});

test('leaks catches commit-body vocabulary in its bold and bullet shapes, not a prose mention', () => {
  for (const line of ['+What: x', '+**What:** x', '+- Verified: node x -> rc 0', '+- **Next:** y', '+  * Ruled out: z']) {
    assert.deepEqual(leaks(line, CTX).map((l) => l.pattern), ['commit-body vocabulary'], line);
  }
  for (const line of ['+// What: is checked here, see below', ' What: context line', '+the Verified: column']) assert.deepEqual(leaks(line, CTX), [], line);
});

// ---- grading packet ------------------------------------------------------------------------

test('blindId is stable for a run under one salt and differs by arm', () => {
  assert.equal(blindId('salt', 'demo-1', 'bare', 1), blindId('salt', 'demo-1', 'bare', 1));
  assert.notEqual(blindId('salt', 'demo-1', 'bare', 1), blindId('salt', 'demo-1', 'current', 1));
  assert.match(blindId('salt', 'demo-1', 'bare', 1), /^[0-9a-f]{8}$/);
});

test('buildPacket holds the Done-when boxes, gate rcs and the anonymized diff, and never the arm', () => {
  const t = ticket({ title: 'Fix it' });
  const body = '## Done when\n- [ ] it works\n- [ ] it has a test\n';
  const diff = `diff --git a/x b/x\n+// ran from ${ROUND}\\code\\.worktrees\\claude-config-129 with --safe-mode\ndiff --git a/COMMIT_MSG_3.txt b/COMMIT_MSG_3.txt\n+Next: y\n`;
  const packet = buildPacket({ id: 'abcd1234', ticket: t, body, diff, gates: [{ name: 'test', rc: 1, excerpt: `FAIL ${ROUND.replace(/\\/g, '/')}/code/.worktrees/claude-config-129/scripts/test/lib.test.mjs` }], ctx: CTX });
  assert.match(packet, /^# Grading packet abcd1234/);
  assert.match(packet, /1\. it works\n2\. it has a test/);
  assert.match(packet, /\| test \| 1 \|/);
  assert.match(packet, /FAIL <repo>\/scripts\/test\/lib\.test\.mjs/);
  assert.match(packet, /\+\/\/ ran from <repo> with <redacted>/);
  assert.doesNotMatch(packet, /bare|current|safe-mode|AppData|COMMIT_MSG|Next:/i);
  assert.match(packet, /pass \/ fail \/ unverifiable/);
});

test('buildPacket refuses a packet that still carries commit-body vocabulary outside a COMMIT_MSG file', () => {
  assert.throws(() => buildPacket({ id: 'x', ticket: ticket(), body: '', diff: 'diff --git a/n.txt b/n.txt\n+Ruled out: z\n', gates: [], ctx: CTX }), /commit-body vocabulary/);
});

test('exclusionReason holds back a run whose scan flagged a reach into the real workspace, config or temp', () => {
  assert.equal(exclusionReason({ contamination: [] }), null);
  assert.equal(exclusionReason({}), null);
  assert.equal(
    exclusionReason({ contamination: [{ source: 'transcripts', label: 'workspace', count: 2 }, { source: 'gate-test.log', label: 'config', count: 1 }] }),
    'contaminated: workspace 2x in transcripts, config 1x in gate-test.log',
  );
  assert.equal(exclusionReason({ contamination: [{ label: 'workspace', count: 1 }] }), 'contaminated: workspace 1x in transcripts', 'a round-3 result names no source');
});

test('gradeTemplate has one unfilled entry per Done-when box and an unfilled 1-5 quality note', () => {
  assert.deepEqual(gradeTemplate('abcd1234', 'demo-1', ['a', 'b']), {
    packet: 'abcd1234',
    ticket: 'demo-1',
    boxes: [
      { n: 1, text: 'a', verdict: null, evidence: '' },
      { n: 2, text: 'b', verdict: null, evidence: '' },
    ],
    quality: { score: null, note: '' },
  });
});

// ---- isolation canary ------------------------------------------------------------------------

test('analyzeRequests reports loaded CLAUDE.md files, loaded memory content and markers, not the memory instructions', () => {
  const markers = { root: 'MARK-ROOT', project: 'MARK-PROJECT', memory: 'MARK-MEMORY' };
  const loaded = JSON.stringify({
    system: [{ text: 'You have a persistent file-based memory at C:\\m. MEMORY.md is the index.' }],
    messages: [{ content: 'Contents of C:\\Users\\y\\code\\CLAUDE.md (project instructions):\nMARK-ROOT\nContents of C:\\p\\CLAUDE.md:\nMARK-PROJECT\nContents of C:\\c\\projects\\k\\memory\\MEMORY.md (user\'s auto-memory):\n- MARK-MEMORY' }],
  });
  assert.deepEqual(analyzeRequests([loaded], markers), {
    requests: 1,
    claudeMdFiles: ['C:\\Users\\y\\code\\CLAUDE.md', 'C:\\p\\CLAUDE.md'],
    memoryFiles: ['C:\\c\\projects\\k\\memory\\MEMORY.md'],
    markers: { root: true, project: true, memory: true },
  });
  const instructionsOnly = JSON.stringify({ system: 'You have a persistent file-based memory at C:\\m. Add a pointer in MEMORY.md.', messages: [{ content: 'hi' }] });
  assert.deepEqual(analyzeRequests([instructionsOnly], markers), { requests: 1, claudeMdFiles: [], memoryFiles: [], markers: { root: false, project: false, memory: false } });
});

test('the canary stub captures each Messages request and answers it as a stream and as JSON', async () => {
  const stub = await startStub();
  try {
    const post = (body) => fetch(`${stub.url}/v1/messages?beta=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const streamed = await post({ model: 'm', stream: true, messages: [{ role: 'user', content: 'MARK' }] });
    const text = await streamed.text();
    assert.match(streamed.headers.get('content-type'), /text\/event-stream/);
    for (const ev of ['message_start', 'content_block_delta', 'message_stop']) assert.match(text, new RegExp(`event: ${ev}`));
    const plain = await (await post({ model: 'm', messages: [] })).json();
    assert.equal(plain.type, 'message');
    assert.equal((await fetch(`${stub.url}/other`)).status, 404);
    assert.equal(stub.bodies.length, 2);
    assert.match(stub.bodies[0], /MARK/);
  } finally {
    await stub.close();
  }
});

test('the canary stub stops answering after its request cap', async () => {
  const stub = await startStub({ cap: 1 });
  try {
    const post = () => fetch(`${stub.url}/v1/messages`, { method: 'POST', body: '{}' });
    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 400);
  } finally {
    await stub.close();
  }
});

test('the ticket prompt files carry no machine paths', () => {
  const m = loadManifest(MANIFEST);
  for (const t of m.tickets) assert.doesNotMatch(readFileSync(join(AB, 'tickets', `${t.id}.md`), 'utf8'), /[A-Z]:[\\/]Users|AppData/i, t.id);
});
