// node --test scripts/test/ab.test.mjs
// #271 A/B runner, pure parts: manifest, round layout and env, settings for an arm, the estimate,
// the blind anonymizer and packets, the isolation canary's analysis and stub. The live path is in ab-run.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedEnv, spawnHarness, tempDir } from './_spawn.mjs';
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
  scanRoots,
  selectRounds,
  subagentMetrics,
  subagentNotes,
  transcriptParts,
  transformSettings,
  usesHarness,
} from '../ab/ab-lib.mjs';
import { anonymize, dropFiles, leaks, pathVariants } from '../ab/anonymize.mjs';
import { blindId, buildPacket, exclusionReason, gradeTemplate } from '../ab/grade.mjs';
import { TOKEN_PLACEHOLDER, redactSecret, treeHasLine } from '../ab/round.mjs';
import { analyzeRequests, canaryVerdict, deferralGap, startStub } from '../ab/canary.mjs';
import { transcriptTokens } from '../ab/results-lib.mjs';

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
  spawnExpected: false,
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

test('#374: the manifest marks the tickets whose merged PR had several independent files or steps as spawnExpected', () => {
  const m = loadManifest(MANIFEST);
  for (const t of m.tickets) assert.equal(typeof t.spawnExpected, 'boolean', t.id);
  // 170: two features in one script; 113: a cost axis, a CI check and a doc re-derivation over 8 files;
  // 129: one helper swapped into 9 hooks and scripts. The other seven are one script or test plus its doc line.
  assert.deepEqual(m.tickets.filter((t) => t.spawnExpected).map((t) => t.id).sort(), ['claude-config-113', 'claude-config-129', 'claude-config-170']);
});

test('#369: the manifest holds the seven project tickets as pending, apps 3, web 3, games 1, each with its repo gates, a prompt and a spawn mark', () => {
  const m = loadManifest(MANIFEST);
  const byDomain = (d) => m.pending.filter((t) => t.path.startsWith(`${d}/`)).map((t) => t.id);
  assert.deepEqual(byDomain('apps'), ['strate-86', 'strate-87', 'strate-89']);
  assert.deepEqual(byDomain('web'), ['component-library-135', 'component-library-136', 'component-library-106']);
  assert.deepEqual(byDomain('games'), ['dog-eat-dog-12']);
  const parent = (id) => m.pending.find((t) => t.id === id).parent;
  // Parents as the user picked them (#369, 2026-11-10), full SHAs from the local clones.
  for (const [id, short] of [['strate-86', '421968200'], ['strate-87', '63a278363'], ['strate-89', '9873e911e'], ['component-library-136', '7be69a0'], ['component-library-135', 'd3bda19e2'], ['component-library-106', '564031e89'], ['dog-eat-dog-12', '00c6a07']]) {
    assert.ok(parent(id).startsWith(short), id);
  }
  const gates = (id) => m.pending.find((t) => t.id === id).gates.map((g) => g.cmd);
  assert.deepEqual(gates('strate-89'), ['bun run typecheck', 'bun run lint', 'bun run test', 'bun run build', 'cargo fmt --all --check', 'cargo clippy --workspace --all-targets -- -D warnings', 'cargo test --workspace']);
  assert.deepEqual(gates('component-library-106'), ['pnpm typecheck', 'pnpm lint', 'pnpm test']);
  assert.deepEqual(gates('dog-eat-dog-12'), ['just import', 'just cache', 'just test']);
  assert.deepEqual(m.pending.filter((t) => !t.spawnExpected).map((t) => t.id), ['component-library-106', 'dog-eat-dog-12']);
  for (const t of m.pending) {
    assert.ok(doneWhen(t.body).length >= 2, `${t.id} has Done-when boxes`);
    assert.doesNotMatch(t.body, /[A-Z]:[\\/]Users|AppData/i, t.id);
  }
  assert.equal(doneWhen(m.pending.find((t) => t.id === 'strate-89').body).length, 4, '#89 and #90 under one Done-when');
  assert.doesNotMatch(m.pending.find((t) => t.id === 'component-library-106').body, /!== undefined|passes `undefined`|wrapper/, 'symptom only, no fix');
  assert.match(m.pending.find((t) => t.id === 'dog-eat-dog-12').why, /test_lab_smoke\.gd/, 'the as-filed body\'s wrong file item is noted');
  // Pending tickets never run: the runner has no setup, LFS or per-repo harness step for them yet.
  assert.equal(selectRounds(m, {}).length, 60);
});

test('parseManifest checks each pending ticket like a ticket, except that its path is a project repo', () => {
  const p = (over) => manifestText([ticket()], { pending: [ticket({ id: 'proj-1', path: 'web/lib', ...over })] });
  assert.equal(parseManifest(p({})).pending[0].id, 'proj-1');
  assert.throws(() => parseManifest(p({ parent: 'abc' })), /pending proj-1: parent must be a 40-char SHA/);
  assert.throws(() => parseManifest(p({ spawnExpected: undefined })), /pending proj-1: spawnExpected must be true or false/);
  assert.throws(() => parseManifest(p({ path: 'claude-config' })), /pending proj-1: path must be a project repo/);
  assert.throws(() => parseManifest(p({ id: 'demo-1' })), /duplicate ticket id demo-1/);
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
  assert.throws(() => parseManifest(manifestText([ticket({ spawnExpected: undefined })])), /demo-1: spawnExpected must be true or false/);
  assert.throws(() => parseManifest(manifestText([ticket({ spawnExpected: 'yes' })])), /demo-1: spawnExpected must be true or false/);
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
  assert.deepEqual(transformSettings(settings, { ...opts, arm: 'solo' }), cur, 'solo runs the same harness settings as current');
  assert.ok(settings.hooks.Stop, 'the input is not mutated');
});

test('usesHarness: current and solo run the harness, bare does not', () => {
  assert.deepEqual(ARMS.filter(usesHarness), ['current', 'solo']);
});

test('pruneClaudeJson keeps the account and drops per-project history and usage', () => {
  assert.deepEqual(pruneClaudeJson({ oauthAccount: { a: 1 }, userID: 'u', projects: { x: {} }, githubRepoPaths: {}, skillUsage: {}, agentLastUsed: {}, mcpServers: {} }), { oauthAccount: { a: 1 }, userID: 'u' });
});

test('projectKey is the transcript folder name Claude Code derives from a cwd', () => {
  assert.equal(projectKey('C:\\Users\\young\\code\\.worktrees\\ab-x'), 'C--Users-young-code--worktrees-ab-x');
});

// ---- the claude command and env ---------------------------------------------------------------

test('the arms run the same command except that bare adds --safe-mode and solo denies the Agent and Workflow tools', () => {
  const opts = { model: 'claude-opus-5-5', effort: 'high', permissionMode: 'auto', budgetUsd: 20 };
  const current = claudeArgs('current', opts);
  const bare = claudeArgs('bare', opts);
  assert.deepEqual(bare, ['--safe-mode', ...current]);
  // claude --help (2.1.322): "--disallowedTools <tools...> Comma or space-separated list of tool names to deny".
  assert.deepEqual(claudeArgs('solo', opts), [...current, '--disallowedTools', 'Agent,Workflow']);
  for (const [flag, value] of [['--model', 'claude-opus-5-5'], ['--output-format', 'json'], ['--effort', 'high'], ['--permission-mode', 'auto'], ['--permission-prompts', 'none'], ['--max-budget-usd', '20']]) {
    assert.equal(current[current.indexOf(flag) + 1], value, flag);
  }
  assert.ok(current.includes('-p'));
  assert.throws(() => claudeArgs('other', opts), /arm must be one of bare, current, solo/);
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

// chmod 0o444 is the read-only attribute on Windows and a mode root ignores on POSIX.
const asRoot = process.getuid?.() === 0;

test('redactSecret (#279) walks past each file it cannot write, redacts the rest, then throws naming those files', { skip: asRoot && 'root writes a read-only file' }, () => {
  const d = tempDir('ab-redact-locked-');
  mkdirSync(join(d, 'sub'));
  // A locked file and an open one in each of two dirs: whatever order the walk takes, it meets a locked
  // file before at least one open file, so stopping there would leave that open file unredacted.
  const locked = [join(d, 'locked.txt'), join(d, 'sub', 'locked.txt')];
  const open = [join(d, 'open.txt'), join(d, 'sub', 's.jsonl')];
  for (const f of [...locked, ...open]) writeFileSync(f, '"TOKEN-123"\n');
  for (const f of locked) chmodSync(f, 0o444);
  assert.throws(() => redactSecret(d, 'TOKEN-123'), (e) => /could not redact the token from 2 file/.test(e.message) && locked.every((f) => e.message.includes(f)) && !e.message.includes('TOKEN-123'));
  for (const f of open) assert.equal(readFileSync(f, 'utf8'), `"${TOKEN_PLACEHOLDER}"\n`, f);
  for (const f of locked) chmodSync(f, 0o644);
});

test('parseClaudeJson reads cost, turns and duration from --output-format json, and flags unreadable output', () => {
  const ok = parseClaudeJson(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1200, num_turns: 7, total_cost_usd: 1.5, session_id: 'x', result: 'done' }));
  assert.deepEqual(ok, { ok: true, subtype: 'success', isError: false, costUsd: 1.5, turns: 7, durationMs: 1200, sessionId: 'x', result: 'done', modelUsage: null, subagentsSpawned: null });
  const bad = parseClaudeJson('Error: boom');
  assert.equal(bad.ok, false);
  assert.equal(bad.costUsd, null);
  assert.equal(bad.modelUsage, null);
  assert.equal(bad.subagentsSpawned, null);
});

test('parseClaudeJson (#374) keeps the per-model usage and the spawn count claude reports', () => {
  const modelUsage = { 'claude-opus-5-5': { inputTokens: 1, outputTokens: 2, costUSD: 0.7 }, 'claude-sonnet-5-5': { costUSD: 0.3 } };
  const j = parseClaudeJson(JSON.stringify({ type: 'result', total_cost_usd: 1, modelUsage, subagent_stats: { spawned: 3, by_type: {} } }));
  assert.deepEqual(j.modelUsage, modelUsage);
  assert.equal(j.subagentsSpawned, 3);
});

// ---- subagent metrics (#374) ------------------------------------------------------------------

/** An assistant transcript line: `agent` set makes it a subagent's (isSidechain), as Claude Code writes it. */
const said = (id, model, usage, agent) => JSON.stringify({ type: 'assistant', ...(agent && { isSidechain: true, agentId: agent }), message: { id, model, role: 'assistant', usage } });

test('subagentMetrics counts the subagents a round spawned, the models they ran on and their share of tokens and cost', () => {
  const jsonl = [
    said('m1', 'claude-opus-5-5', { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    // One message split over two lines (a line per content block): counted once.
    said('s1', 'claude-sonnet-5-5', { input_tokens: 10, output_tokens: 20 }, 'a1'),
    said('s1', 'claude-sonnet-5-5', { input_tokens: 10, output_tokens: 20 }, 'a1'),
    // A second subagent that only got its prompt before the round ended still counts as spawned.
    JSON.stringify({ type: 'user', isSidechain: true, agentId: 'a2', message: { role: 'user', content: 'go' } }),
    // Claude Code's synthetic messages carry no real usage.
    said('x', '<synthetic>', { input_tokens: 0, output_tokens: 0 }),
    'not json',
    '',
  ].join('\n');
  const usage = { 'claude-opus-5-5': { costUSD: 0.2 }, 'claude-sonnet-5-5': { costUSD: 0.05 } };
  assert.deepEqual(subagentMetrics(jsonl, usage), {
    spawned: 2,
    models: ['claude-sonnet-5-5'],
    tokens: { subagent: 30, total: 180, share: 0.167 },
    costUsd: { subagent: 0.05, total: 0.25, share: 0.2 },
  });
});

test('subagentMetrics splits a model the session and its subagents share by priced token weight', () => {
  // Weights against an input token: output 5, cache read 0.1, a 5-minute cache write 1.25, a 1-hour one 2.
  const jsonl = [
    // 100 input + 100 cache read (10) + 40 five-minute writes (50) + 20 one-hour writes (40) = 200.
    said('m1', 'claude-opus-5-5', { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 100, cache_creation_input_tokens: 60, cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 20 } }),
    // 120 output = 600; a write with no breakdown counts as 5-minute.
    said('s1', 'claude-opus-5-5', { input_tokens: 0, output_tokens: 120, cache_creation_input_tokens: 0 }, 'a1'),
  ].join('\n');
  const m = subagentMetrics(jsonl, { 'claude-opus-5-5': { costUSD: 1 } });
  assert.deepEqual(m.costUsd, { subagent: 0.75, total: 1, share: 0.75 });
  assert.deepEqual(m.tokens, { subagent: 120, total: 380, share: 0.316 });
  assert.deepEqual(m.models, ['claude-opus-5-5']);
});

test('subagentMetrics: no transcript means none spawned; no per-model usage from claude leaves the cost share unknown; a model only claude saw stays the session\'s', () => {
  assert.deepEqual(subagentMetrics('', { 'claude-opus-5-5': { costUSD: 0.4 } }), {
    spawned: 0,
    models: [],
    tokens: { subagent: 0, total: 0, share: null },
    costUsd: { subagent: 0, total: 0.4, share: 0 },
  });
  const jsonl = said('s1', 'claude-haiku-5-5', { input_tokens: 5, output_tokens: 5 }, 'a1');
  assert.equal(subagentMetrics(jsonl, null).costUsd, null);
  // canonicalModel answers a modelUsage key the transcripts spell differently.
  assert.deepEqual(subagentMetrics(jsonl, { 'haiku[1m]': { canonicalModel: 'claude-haiku-5-5', costUSD: 0.1 }, 'claude-opus-5-5': { costUSD: 0.3 } }).costUsd, { subagent: 0.1, total: 0.4, share: 0.25 });
  assert.deepEqual(subagentMetrics('', {}).costUsd, { subagent: 0, total: 0, share: null });
});

test('subagentMetrics and transcriptTokens count a model call by one rule: message id, then requestId, then uuid; <synthetic> never counts', () => {
  const line = (o) => JSON.stringify({ type: 'assistant', ...o });
  const u = { input_tokens: 4, output_tokens: 6 };
  const jsonl = [
    line({ requestId: 'r1', message: { model: 'claude-opus-5-5', usage: u } }),
    line({ requestId: 'r1', message: { model: 'claude-opus-5-5', usage: u } }),
    line({ uuid: 'u1', message: { model: 'claude-opus-5-5', usage: u } }),
    line({ uuid: 'u1', message: { model: 'claude-opus-5-5', usage: u } }),
    line({ message: { id: 'syn', model: '<synthetic>', usage: { input_tokens: 99, output_tokens: 99 } } }),
  ].join('\n');
  assert.equal(subagentMetrics(jsonl, null).tokens.total, 20);
  assert.deepEqual(transcriptTokens([jsonl]), { inputTokens: 8, outputTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0 });
});

test('subagentNotes reports a current run that spawned none as measuring what solo does, a solo run that spawned any, and a count claude disagrees with', () => {
  const none = { spawned: 0 };
  const two = { spawned: 2 };
  assert.deepEqual(subagentNotes('current', none, 0), ['none spawned: this current run measures the same thing as the solo arm']);
  assert.deepEqual(subagentNotes('current', two, 2), []);
  assert.deepEqual(subagentNotes('solo', none, 0), []);
  assert.deepEqual(subagentNotes('solo', two, null), ['solo spawned 2 subagent(s): spawning was not off']);
  assert.deepEqual(subagentNotes('bare', none, null), []);
  assert.deepEqual(subagentNotes('current', two, 3), ['claude reports 3 spawned, the transcripts show 2']);
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

test('transcriptParts (#279) puts the content fields of Edit, Write and MultiEdit in edits, unescaped; their paths and every other tool input stay in inputs', () => {
  const jsonl = [
    toolCall('Edit', { file_path: 'IN-EDIT-PATH', old_string: 'ED-OLD "q" C:\\x', new_string: 'ED-NEW\nline 2', replace_all: false }),
    toolCall('Write', { file_path: 'IN-WRITE-PATH', content: 'ED-CONTENT\r\n' }),
    toolCall('MultiEdit', { file_path: 'IN-MULTI-PATH', edits: [{ old_string: 'ED-M-OLD', new_string: 'ED-M-NEW', replace_all: true }] }),
    toolCall('NotebookEdit', { notebook_path: 'IN-NB', new_source: 'IN-NB-SOURCE' }),
    toolCall('Bash', { command: 'IN-BASH' }),
  ].join('\n');
  const { inputs, served, edits } = transcriptParts(jsonl);
  for (const s of ['IN-EDIT-PATH', 'IN-WRITE-PATH', 'IN-MULTI-PATH', 'IN-NB', 'IN-NB-SOURCE', 'IN-BASH']) assert.match(inputs, new RegExp(s), s);
  for (const s of ['ED-OLD', 'ED-NEW', 'ED-CONTENT', 'ED-M-OLD', 'ED-M-NEW']) {
    assert.doesNotMatch(inputs, new RegExp(s), s);
    assert.doesNotMatch(served, new RegExp(s), s);
  }
  // The field text itself, JSON escaping undone, one field after another.
  assert.equal(edits, 'ED-OLD "q" C:\\x\nED-NEW\nline 2\nED-CONTENT\r\n\nED-M-OLD\nED-M-NEW');
});

/** treeHasLine's semantics (git grep -F -h lists the lines holding it, then one must equal it): the line is a whole line of some tree file. */
const treeLines = (l) => Object.values(TREE_FILES).some((f) => f.split('\n').includes(l));
const README_LINE = TREE_FILES['hooks/README.md'].trimEnd();

test('scanContamination (#279, user 2026-10-19 "Explain if tree has line"): an edit content line that is a whole tree line is explained; a new line, a substring of a tree line and every path field flag', () => {
  const tmp = 'C:\\Users\\u\\AppData\\Local\\Temp';
  const jsonl = [
    // Keeps the tree's live-hook line (old and new): explained twice. Adds a line spelling the workspace: flagged.
    toolCall('Edit', { file_path: 'hooks/README.md', old_string: README_LINE, new_string: `${README_LINE}\nsee C:/Users/u/code/claude-config/x` }),
    // A whole tree line with CRLF endings is still that line; the tree line without its indent is not.
    toolCall('Write', { file_path: 'C:\\Users\\u\\code\\claude-config\\hooks\\README.md', content: `${README_LINE}\r\n${README_LINE.trimStart()}\r\n` }),
    // Round 5 Major A: the tree spells this path inside longer lines, never as a line of its own.
    toolCall('MultiEdit', { file_path: 'x.sh', edits: [{ old_string: 'a', new_string: 'cd C:/Users/u/code/claude-config\nexport TMPDIR=/tmp' }] }),
  ].join('\n');
  assert.ok(treeSpells('cd C:/Users/u/code/claude-config') === false && treeSpells('C:/Users/u/code/claude-config'), 'the premise: a substring of a tree line');
  const { inputs, served, edits } = transcriptParts(jsonl);
  const scan = scanContamination({ transcripts: served, 'tool inputs': inputs, 'edit content': edits }, SCAN_ROOTS, { explains: treeSpells, lineExplains: treeLines, byLine: ['edit content'], written: ['tool inputs'], tmp });
  assert.deepEqual(scan, {
    flagged: [
      { source: 'tool inputs', label: 'workspace', count: 1, paths: ['C:\\Users\\u\\code\\claude-config\\hooks\\README.md'] },
      { source: 'edit content', label: 'workspace', count: 3, paths: ['C:/Users/u/code/claude-config/x', 'C:/Users/u/code/claude-config/hooks/bash-guard.mjs', 'C:/Users/u/code/claude-config'] },
      { source: 'edit content', label: 'temp', count: 1, paths: ['/tmp'] },
    ],
    explained: [{ source: 'edit content', label: 'workspace', count: 3, paths: ['C:/Users/u/code/claude-config/hooks/bash-guard.mjs'] }],
  });
});

test('treeHasLine (#279) answers whether a line is a whole line of a tree at its commit, LF or CRLF, never a substring or a later commit', () => {
  const repo = tempDir('ab-treeline-');
  const g = (...args) => {
    const r = spawnSync('git', ['-C', repo, '-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', env: isolatedEnv(repo) });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  g('init', '--quiet');
  writeFileSync(join(repo, 'lf.md'), '  "args": ["C:/Users/u/code/x.mjs"]\n-starts with a dash\n');
  writeFileSync(join(repo, 'crlf.ps1'), '# memory by path: C:\\Users\\u\\code\r\nnext\r\n');
  g('add', '-A');
  g('commit', '--quiet', '-m', 'base');
  const sha = g('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'lf.md'), 'later C:/Users/u/code/y\n');
  g('commit', '--quiet', '-am', 'later');
  const has = treeHasLine([{ repo, sha }]);
  for (const l of ['  "args": ["C:/Users/u/code/x.mjs"]', '-starts with a dash', '# memory by path: C:\\Users\\u\\code']) assert.equal(has(l), true, l);
  for (const l of ['"args": ["C:/Users/u/code/x.mjs"]', 'C:/Users/u/code/x.mjs', '# memory by path: C:\\Users\\u', 'later C:/Users/u/code/y', 'a\0b']) assert.equal(has(l), false, JSON.stringify(l));
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

test('scanContamination on POSIX roots (CI on Linux): whole paths are reported, and /tmp is a plain path, not the Git Bash alias', () => {
  // Every root under /tmp, as on a Linux runner; none overlaps another.
  const roots = [{ path: '/tmp/w/code', label: 'workspace' }, { path: '/tmp/w/.claude', label: 'config' }, { path: '/tmp/w/t', label: 'temp' }];
  const inputs = JSON.stringify({ command: 'cat /tmp/w/code/claude-config/x /tmp/w/.claude/projects/p.jsonl /tmp/w/t/claude/n.md && ls /tmp/other /tmp' });
  assert.deepEqual(scanContamination({ 'tool inputs': inputs }, roots, { tmp: '/tmp/w/t', written: ['tool inputs'] }), {
    flagged: [
      { source: 'tool inputs', label: 'workspace', count: 1, paths: ['/tmp/w/code/claude-config/x'] },
      { source: 'tool inputs', label: 'config', count: 1, paths: ['/tmp/w/.claude/projects/p.jsonl'] },
      { source: 'tool inputs', label: 'temp', count: 1, paths: ['/tmp/w/t/claude/n.md'] },
    ],
    explained: [],
  });
});

test('scanContamination right boundary (#279): a root followed by `.` or `:` and then a non-name character, or the end, is the root; code2 and code.bak are not', () => {
  const roots = [...SCAN_ROOTS, { path: 'C:\\Users\\u\\.claude.json', label: '.claude.json' }];
  // The round-6 probes (rv6/probe-ab.txt), as commands the session wrote.
  const probes = [
    ['cat C:/Users/u/.claude.json', '.claude.json', 'C:/Users/u/.claude.json'],
    ['PATH=/c/Users/u/code:$PATH node x.mjs', 'workspace', '/c/Users/u/code'],
    ['type C:\\Users\\u\\code.\\x', 'workspace', 'C:\\Users\\u\\code.\\x'],
    ['ls C:\\Users\\u\\code.', 'workspace', 'C:\\Users\\u\\code'],
    ['echo "C:/Users/u/code.";', 'workspace', 'C:/Users/u/code'],
    ['dir C:\\Users\\u\\code:', 'workspace', 'C:\\Users\\u\\code'],
  ];
  for (const [command, label, path] of probes) {
    const { inputs } = transcriptParts(toolCall('Bash', { command }));
    assert.deepEqual(scanContamination({ 'tool inputs': inputs }, roots, { written: ['tool inputs'] }), { flagged: [{ source: 'tool inputs', label, count: 1, paths: [path] }], explained: [] }, command);
  }
  // A PATH list names each entry once.
  assert.deepEqual(scanContamination({ log: 'PATH=/c/Users/u/code/a:/c/Users/u/code/b' }, roots).flagged, [{ source: 'log', label: 'workspace', count: 2, paths: ['/c/Users/u/code/a', '/c/Users/u/code/b'] }]);
  for (const other of ['C:\\Users\\u\\code2\\x', 'C:/Users/u/code.bak/x', 'C:/Users/u/code..bak', 'C:\\Users\\u\\.claude-old\\x', 'C:/Users/u/.claude.json.bak']) {
    assert.deepEqual(scanContamination({ log: `cat ${other}` }, roots), { flagged: [], explained: [] }, other);
  }
});

test('scanContamination right boundary on POSIX roots (CI on Linux)', () => {
  const roots = [{ path: '/tmp/w/code', label: 'workspace' }, { path: '/tmp/w/.claude', label: 'config' }, { path: '/tmp/w/.claude.json', label: '.claude.json' }];
  const log = 'cat /tmp/w/.claude.json; PATH=/tmp/w/code:$PATH; ls /tmp/w/code./x /tmp/w/code2 /tmp/w/code.bak /tmp/w/.claude-old';
  assert.deepEqual(scanContamination({ log }, roots).flagged, [
    { source: 'log', label: 'workspace', count: 2, paths: ['/tmp/w/code', '/tmp/w/code./x'] },
    { source: 'log', label: '.claude.json', count: 1, paths: ['/tmp/w/.claude.json'] },
  ]);
});

test("scanRoots: the workspace, the config dir, the global .claude.json and its .backup, and temp; the .json pair only when it sits outside the config dir", () => {
  const w = { workspace: '/h/code', config: '/h/.claude', temp: '/t' };
  assert.deepEqual(scanRoots({ ...w, globalJson: '/h/.claude.json' }), [
    { path: '/h/code', label: 'workspace' },
    { path: '/h/.claude', label: 'config' },
    { path: '/h/.claude.json', label: '.claude.json' },
    { path: '/h/.claude.json.backup', label: '.claude.json.backup' },
    { path: '/t', label: 'temp' },
  ]);
  // CLAUDE_CONFIG_DIR set: the files are <config>/.claude.json[.backup], which the config root already covers.
  assert.deepEqual(scanRoots({ ...w, globalJson: '/h/.claude/.claude.json' }).map((r) => r.label), ['workspace', 'config', 'temp']);
  // Claude Code keeps a .backup copy of the same account data beside .claude.json (#279).
  const roots = scanRoots({ workspace: 'C:\\Users\\u\\code', config: 'C:\\Users\\u\\.claude', globalJson: 'C:\\Users\\u\\.claude.json', temp: 'C:\\T' });
  assert.deepEqual(scanContamination({ log: 'cat C:/Users/u/.claude.json.backup' }, roots).flagged, [{ source: 'log', label: '.claude.json.backup', count: 1, paths: ['C:/Users/u/.claude.json.backup'] }]);
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
  assert.equal(selectRounds(m, {}).length, 12);
  assert.deepEqual(selectRounds(m, { only: 'demo-2', arm: 'bare', run: '2' }).map((r) => [r.ticket.id, r.arm, r.run]), [['demo-2', 'bare', 2]]);
  assert.deepEqual(selectRounds(m, { only: 'demo-1', run: '1' }).map((r) => r.arm), ['bare', 'current', 'solo']);
  assert.throws(() => selectRounds(m, { only: 'nope' }), /unknown ticket nope/);
  assert.throws(() => selectRounds(m, { arm: 'x' }), /arm must be one of bare, current, solo/);
  assert.throws(() => selectRounds(m, { run: '3' }), /run must be 1\.\.2/);
  assert.deepEqual(ARMS, ['bare', 'current', 'solo']);
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
  const solo = planRound(m, m.tickets[0], 'solo', 1, WHERE, []);
  assert.deepEqual(solo.claude.args, [...cur.claude.args, '--disallowedTools', 'Agent,Workflow']);
  assert.deepEqual(solo.layout, p.layout);
  assert.deepEqual(solo.estimate, cur.estimate, 'solo gets the same estimate and cap');
  assert.equal(solo.resultsDir, join('C:\\O', 'runs', 'demo-1', 'solo-r1'));
});

test('planRound caps both arms of a ticket the same, from the prior, whatever a measured run spent (#288)', () => {
  const m = parseManifest(manifestText([ticket()]));
  const cap = (p) => p.claude.args[p.claude.args.indexOf('--max-budget-usd') + 1];
  const measured = [{ ticketId: m.tickets[0].id, costUsd: 0.9, turns: 19 }];
  const bare = planRound(m, m.tickets[0], 'bare', 1, WHERE, []);
  const cur = planRound(m, m.tickets[0], 'current', 1, WHERE, measured);
  assert.equal(cur.estimate.usd, 0.9, 'the printed estimate still learns from measured runs');
  assert.equal(cap(cur), cap(bare), 'the second arm is not capped by the first arm\'s spend');
  assert.equal(cur.estimate.budgetUsd, 20);
});

test('run.mjs --dry-run prints each round with its commands and estimate, and touches nothing', () => {
  const home = tempDir('ab-home-');
  const out = join(home, 'out');
  const r = spawnHarness(join(AB, 'run.mjs'), ['--dry-run', '--only', 'claude-config-220', '--out', out], { home, env: { CLAUDE_CODE_OAUTH_TOKEN: '', TEMP: join(home, 't'), TMP: join(home, 't'), TMPDIR: join(home, 't') } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /claude-config-220 bare r1/);
  assert.match(r.stdout, /claude-config-220 current r2/);
  assert.match(r.stdout, /claude-config-220 solo r2/);
  assert.match(r.stdout, /est\. \$[\d.]+, ~\d+ turns/);
  assert.match(r.stdout, /--safe-mode -p --model claude-opus-5-5/);
  assert.match(r.stdout, /--max-budget-usd \d+ --disallowedTools Agent,Workflow < /);
  assert.match(r.stdout, /fetch --quiet --no-tags \S+ 8a7f289c6ee314eea26541ec41de4d326608fdfd/);
  assert.match(r.stdout, /harness: claude-config at 8a7f289c6ee314eea26541ec41de4d326608fdfd/);
  assert.match(r.stdout, /harness: as current, with the Agent and Workflow tools removed \(--disallowedTools\): no subagents/);
  assert.match(r.stdout, /node --test "scripts\/test\/\*\.test\.mjs"/);
  // Three arms, two runs each, each with its own estimate.
  const total = /total: 6 round\(s\), est\. \$([\d.]+), ~(\d+) turns; bare 2 \$([\d.]+), current 2 \$([\d.]+), solo 2 \$([\d.]+)/.exec(r.stdout);
  assert.ok(total, r.stdout);
  const [usd, , ...perArm] = total.slice(1).map(Number);
  assert.equal(Math.round(perArm.reduce((s, x) => s + x, 0) * 100) / 100, usd);
  assert.match(r.stdout, /CLAUDE_CODE_OAUTH_TOKEN is not set: a live round will refuse to start\./);
  assert.match(r.stdout, /\$env:CLAUDE_CODE_OAUTH_TOKEN = Read-Host; node scripts\/ab\/run\.mjs --only <ticket> --arm <bare\|current\|solo> --run <n>/);
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
  assert.match(r.stderr, /a live run takes exactly one round: --only <ticket> --arm <bare\|current\|solo> --run <n>/);
});

test('run.mjs and canary.mjs refuse to start without CLAUDE_CODE_OAUTH_TOKEN, and never fall back to copying the login', () => {
  const home = tempDir('ab-notoken-');
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude', '.credentials.json'), '{"claudeAiOauth":{}}');
  const env = { CLAUDE_CODE_OAUTH_TOKEN: '', TEMP: join(home, 't'), TMP: join(home, 't'), TMPDIR: join(home, 't') };
  const run = spawnHarness(join(AB, 'run.mjs'), ['--only', 'claude-config-220', '--arm', 'bare', '--run', '1', '--out', join(home, 'out')], { home, env });
  const canary = spawnHarness(join(AB, 'canary.mjs'), ['--arm', 'bare', '--out', join(home, 'out')], { home, env });
  for (const [name, r, cmd] of [['run', run, 'run\\.mjs --only <ticket> --arm <bare\\|current\\|solo>'], ['canary', canary, 'canary\\.mjs --arm <bare\\|current\\|solo>']]) {
    assert.notEqual(r.status, 0, name);
    assert.match(r.stderr, /needs CLAUDE_CODE_OAUTH_TOKEN\. Create one once with `claude setup-token`/, name);
    assert.match(r.stderr, new RegExp(`\\$env:CLAUDE_CODE_OAUTH_TOKEN = Read-Host; node scripts/ab/${cmd}`), name);
    assert.match(r.stderr, /every Claude Code session would run on that token/, name);
  }
  assert.equal(existsSync(join(home, 'out')), false, 'nothing written');
  assert.equal(existsSync(join(home, 't', 'ab')), false, 'no round built');
});

test('canary.mjs (#279) removes its round when the round fails, and under --keep names it for removal', () => {
  // The fixture workspace has no claude-config repo, so the checkout fetch throws after the round dir exists.
  // The token is a dummy and AB_CLAUDE_BIN names no file: no claude runs.
  for (const keep of [false, true]) {
    const home = tempDir('ab-canary-fail-');
    const env = { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-dummy', AB_CLAUDE_BIN: join(home, 'no-claude.mjs'), TEMP: join(home, 't'), TMP: join(home, 't'), TMPDIR: join(home, 't') };
    const r = spawnHarness(join(AB, 'canary.mjs'), ['--arm', 'bare', '--out', join(home, 'out'), ...(keep ? ['--keep'] : [])], { home, env });
    assert.notEqual(r.status, 0, `keep ${keep}`);
    assert.match(r.stderr, /git -C .* fetch .* failed/, `keep ${keep}: the round build failed`);
    const left = existsSync(join(home, 't', 'ab')) ? readdirSync(join(home, 't', 'ab')) : [];
    if (keep) {
      assert.equal(left.length, 1, 'the --keep round is left');
      assert.ok(r.stdout.includes(`Remove-Item -Recurse -Force "${join(home, 't', 'ab', left[0])}"`), r.stdout);
    } else {
      assert.deepEqual(left, [], 'the round is removed');
      assert.match(r.stdout, /removed the round dir/);
    }
  }
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

test('anonymize redacts every arm label, solo included, and leaks names one left in', () => {
  for (const arm of ARMS) {
    assert.equal(anonymize(`see x-${arm}-r3`, CTX), 'see x-<arm>-r3', arm);
    assert.deepEqual(leaks(`ran in x-${arm}-r1`, CTX).map((l) => l.pattern), ['arm label'], arm);
  }
  assert.deepEqual(leaks('a solo-run of x-solos-r1', CTX), [], 'a word that only contains an arm name is no label');
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
    tools: [],
  });
  const instructionsOnly = JSON.stringify({ system: 'You have a persistent file-based memory at C:\\m. Add a pointer in MEMORY.md.', messages: [{ content: 'hi' }] });
  assert.deepEqual(analyzeRequests([instructionsOnly], markers), { requests: 1, claudeMdFiles: [], memoryFiles: [], markers: { root: false, project: false, memory: false }, tools: [] });
});

test('analyzeRequests (#374) lists the tools the requests offered the model, by name, across requests', () => {
  const a = JSON.stringify({ tools: [{ name: 'Read', input_schema: {} }, { name: 'Agent', description: 'Launch a new agent' }], messages: [] });
  const b = JSON.stringify({ tools: [{ name: 'Bash' }, { name: 'Read' }], messages: [] });
  // A prompt that only mentions the Agent tool offers nothing.
  const prose = JSON.stringify({ messages: [{ content: 'use the Agent tool' }] });
  assert.deepEqual(analyzeRequests([a, b, prose, 'not json'], {}).tools, ['Agent', 'Bash', 'Read']);
});

test('canaryVerdict (#374): current needs the Agent tool offered, solo needs Agent and Workflow absent; both need the harness CLAUDE.md and no memory', () => {
  const loaded = (tools, over = {}) => ({ requests: 1, claudeMdFiles: ['C:\\r\\code\\CLAUDE.md'], memoryFiles: [], markers: { project: true, root: true, realMemory: false }, tools, ...over });
  const offered = ['Agent', 'Bash', 'Read', 'Workflow'];
  const denied = ['Bash', 'Read'];
  const v = (arm, a, opts = {}) => canaryVerdict(arm, { plant: false, loggedIn: true, ...opts }, a);
  assert.equal(v('current', loaded(offered)), 'PASS');
  assert.equal(v('current', loaded(denied)), 'FAIL', 'current without Agent is no multi-agent arm');
  assert.equal(v('solo', loaded(denied)), 'PASS');
  assert.equal(v('solo', loaded(offered)), 'FAIL');
  assert.equal(v('solo', loaded(['Bash', 'Workflow'])), 'FAIL', 'Workflow spawns subagents too');
  assert.equal(v('solo', loaded(['Agent'])), 'FAIL');
  assert.equal(v('solo', loaded(denied, { markers: { project: true, root: false } })), 'FAIL', 'solo runs the harness');
  assert.equal(v('solo', loaded(denied, { memoryFiles: ['C:\\m\\MEMORY.md'] })), 'FAIL');
  assert.equal(v('solo', loaded(denied), { loggedIn: false }), 'FAIL');
  assert.equal(v('solo', loaded(denied, { requests: 0 })), 'INCONCLUSIVE');
  const bare = { requests: 1, claudeMdFiles: [], memoryFiles: [], markers: { project: false, root: false }, tools: offered };
  assert.equal(v('bare', bare), 'PASS', 'bare is judged on what loaded, not on its tools');
  assert.equal(v('bare', { ...bare, claudeMdFiles: ['C:\\x\\CLAUDE.md'] }), 'FAIL');
  // A deferred-tool loader (ToolSearch) means a tool can be missing from the list yet loadable, so a solo
  // pass needs a current canary from the same claude version, recorded beside it, that read Agent in its list.
  const deferring = loaded(['Bash', 'Read', 'ToolSearch']);
  const ref = { arm: 'current', plant: false, verdict: 'PASS', tools: ['Agent', 'Bash', 'ToolSearch'], version: '2.1.322' };
  assert.equal(v('solo', deferring), 'FAIL', 'no current record: Agent may only be deferred');
  assert.equal(v('solo', deferring, { version: '2.1.322', current: ref }), 'PASS');
  assert.equal(v('solo', deferring, { version: '2.1.330', current: ref }), 'FAIL', 'a record from another claude version proves nothing');
  assert.equal(v('solo', deferring, { version: '2.1.322', current: { ...ref, tools: ['Bash', 'ToolSearch'] } }), 'FAIL', 'current did not read Agent either');
  assert.equal(v('solo', deferring, { version: '2.1.322', current: { ...ref, verdict: 'FAIL' } }), 'FAIL');
  assert.match(deferralGap(deferring, { version: '2.1.322', current: null }), /run --arm current .* first/);
  assert.equal(deferralGap(loaded(denied), { version: '2.1.322', current: null }), null, 'no loader: the list is the whole offer');
  // --plant-memory: the planted memory must load in a harness arm and must not in bare.
  const planted = (yes) => loaded(denied, { markers: { project: true, root: true, planted: yes }, memoryFiles: yes ? ['C:\\m\\MEMORY.md'] : [] });
  assert.equal(v('solo', planted(true), { plant: true }), 'PASS');
  assert.equal(v('current', planted(false), { plant: true }), 'FAIL');
  assert.equal(v('bare', planted(false), { plant: true }), 'PASS');
  assert.equal(v('bare', planted(true), { plant: true }), 'FAIL');
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
  for (const t of [...m.tickets, ...m.pending]) assert.doesNotMatch(readFileSync(join(AB, 'tickets', `${t.id}.md`), 'utf8'), /[A-Z]:[\\/]Users|AppData/i, t.id);
});
