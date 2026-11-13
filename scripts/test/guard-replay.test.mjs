// node --test scripts/test/guard-replay.test.mjs — guard-replay over a fixture
// transcript and two tiny fake checkouts whose staticCheck differs on one command.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { execHarness, tempDir } from './_spawn.mjs';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'guard-replay.mjs');

function checkout(staticBody, approving = 'true', extra = '', { gated = '() => []', browser = '() => null' } = {}) {
  const dir = tempDir('gr-co-');
  mkdirSync(join(dir, 'hooks'));
  writeFileSync(
    join(dir, 'hooks', 'bash-guard.mjs'),
    `export const staticCheck = (c, cwd, tool) => { ${staticBody} };
export const gatedVerbs = ${gated};
export const browserCommand = ${browser};
export const isApproving = () => ${approving};
${extra}
`,
  );
  writeFileSync(join(dir, 'hooks', '_hooklib.mjs'), 'export const isBrowserApproving = () => false;\n');
  return dir;
}

const bash = (command, name = 'Bash') => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input: { command } }] } });
const answer = (a) => ({ type: 'user', uuid: 'u', toolUseResult: { answers: a } });

function config(files) {
  const cfg = tempDir('gr-cfg-');
  mkdirSync(join(cfg, 'projects', 'p'), { recursive: true });
  for (const [name, rows] of Object.entries(files)) {
    writeFileSync(join(cfg, 'projects', 'p', name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  return cfg;
}

function run(configDir, ...args) {
  return execHarness(script, args, { env: { CLAUDE_CONFIG_DIR: configDir } });
}

test('prints exactly one line per changed verdict, deduped, plus a summary', () => {
  const cfg = config({
    's.jsonl': [bash('git add -A'), bash('git add -A'), bash('ls'), bash('Get-ChildItem', 'PowerShell'), answer({ q: 'Push it' })],
  });
  const oldCo = checkout("return c === 'git add -A' ? 'blocked' : null;");
  const newCo = checkout('return null;');
  const lines = run(cfg, oldCo, newCo).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^staticCheck: "blocked" -> null \| git add -A$/);
  assert.match(lines[1], /^summary: 1 changed; 3 commands, 1 answers from 1 files$/);
});

test('an approval-parser change is reported per answer', () => {
  const cfg = config({ 's.jsonl': [answer({ q: 'Push it' })] });
  const lines = run(cfg, checkout('return null;', 'true'), checkout('return null;', 'false')).trim().split('\n');
  assert.equal(lines.length, 2); // one changed verdict, then summary
  assert.match(lines[0], /^isApproving: true -> false \| Push it$/);
});

test('identical checkouts print only the summary with zero changes', () => {
  const cfg = config({ 's.jsonl': [bash('git add -A')] });
  const co = checkout('return null;');
  assert.match(run(cfg, co, co).trim(), /^summary: 0 changed; 1 commands, 0 answers from 1 files$/);
});

test('--files limits scanning to the newest N transcripts', () => {
  const cfg = config({ 'a.jsonl': [bash('one')], 'b.jsonl': [bash('two')] });
  const co = checkout('return null;');
  assert.match(run(cfg, co, co, '--files', '1').trim(), /1 commands, 0 answers from 1 files/);
});

test('subagent transcripts (projects/*/<session>/subagents/*.jsonl) are scanned too', () => {
  const cfg = config({ 's.jsonl': [bash('one')] });
  const sub = join(cfg, 'projects', 'p', 'sess', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-a.jsonl'), JSON.stringify(bash('two')) + '\n');
  const co = checkout('return null;');
  assert.match(run(cfg, co, co).trim(), /2 commands, 0 answers from 2 files/);
});

test('--files selects the newest N across top-level and subagent transcripts', () => {
  const cfg = config({ 'old.jsonl': [bash('old1'), bash('old2')] });
  const sub = join(cfg, 'projects', 'p', 'sess', 'subagents');
  mkdirSync(sub, { recursive: true });
  const f = join(sub, 'agent-a.jsonl');
  writeFileSync(f, JSON.stringify(bash('newer')) + '\n');
  utimesSync(join(cfg, 'projects', 'p', 'old.jsonl'), new Date(Date.now() - 5000), new Date(Date.now() - 5000));
  const co = checkout('return null;');
  assert.match(run(cfg, co, co, '--files', '1').trim(), /1 commands, 0 answers from 1 files/);
});

test('--files and --days with a missing or non-numeric value print usage', () => {
  const cfg = config({ 's.jsonl': [bash('one')] });
  const co = checkout('return null;');
  for (const args of [['--files'], ['--files', 'abc'], ['--days'], ['--days', 'x']]) {
    assert.match(run(cfg, co, co, ...args).trim(), /^usage:/, args.join(' '));
  }
});

test('answers differing only in key order dedupe to one', () => {
  const cfg = config({ 's.jsonl': [answer({ a: '1', b: '2' }), answer({ b: '2', a: '1' })] });
  const co = checkout('return null;');
  assert.match(run(cfg, co, co).trim(), /0 commands, 1 answers from 1 files/);
});

test('env-assignment secrets are redacted in printed commands', () => {
  const cfg = config({ 's.jsonl': [bash('GH_TOKEN=abc123 API_KEY="s p" MY_SECRET=x curl u')] });
  const out = run(cfg, checkout("return c.includes('curl') ? 'blocked' : null;"), checkout('return null;'));
  assert.match(out, /\| GH_TOKEN=\*\*\* API_KEY=\*\*\* MY_SECRET=\*\*\* curl u\n/);
  assert.doesNotMatch(out, /abc123|s p|=x /);
});

test('a missing projects root reports zero files rather than failing', () => {
  const co = checkout('return null;');
  assert.match(run(tempDir('gr-empty-'), co, co).trim(), /^summary: 0 changed; 0 commands, 0 answers from 0 files$/);
});

test('more secret shapes are redacted; ordinary names and flags are kept', () => {
  const cmds = [
    'DB_PASSWORD=hunter2 run',
    'NPM_PASS=hunter3 run',
    'GH_PAT=ghp_abc run',
    '$env:GH_TOKEN = "tok4" ; run',
    'curl -H "Authorization: Bearer bearer5" u',
    'gh auth login --with-token tok6',
    'monkey=banana run',
    'sort --sort-key=name f',
  ];
  const cfg = config({ 's.jsonl': cmds.map((c) => bash(c)) });
  const out = run(cfg, checkout("return 'blocked';"), checkout('return null;'));
  for (const s of ['hunter2', 'hunter3', 'ghp_abc', 'tok4', 'bearer5', 'tok6']) assert.doesNotMatch(out, new RegExp(s), s);
  assert.match(out, /DB_PASSWORD=\*\*\* run/);
  assert.match(out, /\$env:GH_TOKEN = \*\*\* ; run/);
  assert.match(out, /Authorization: Bearer \*\*\*/);
  assert.match(out, /--with-token \*\*\*/);
  assert.match(out, /monkey=banana run/);
  assert.match(out, /--sort-key=name f/);
});

// --branch fixtures: for a for-loop, the new checkout keeps call #0, moves call #1
// to another dir and adds call #2; it blocks a commit only where HEAD resolves, so
// only the born repo flips. Fields branchRules no longer reads (viaOr, loop) are not
// compared (#368).
const call = (sub, dir, extra = '') => `{ sub: '${sub}', args: [], repo: cwd + '/${dir}'${extra} }`;
const branchOld = `export const scrub = (c) => c;
export const gitCalls = (c, cwd) => (c.includes('git') ? [${call('status', 'sub', ', viaOr: true, loop: true')}, ${call('add', 'sub')}] : []);
export const branchRules = () => null;`;
const branchNew = `import { spawnSync } from 'node:child_process';
export const scrub = (c) => c;
export const gitCalls = (c, cwd) => {
  if (!c.includes('git')) return [];
  const loop = c.startsWith('for');
  return [${call('status', 'sub', ', viaOr: false, loop: false')}, ${call('add', "' + (loop ? 'other' : 'sub') + '")}, ...(loop ? [${call('add', 'sub')}] : [])];
};
export const branchRules = (c, cwd) =>
  c.includes('commit') && spawnSync('git', ['-C', cwd, 'rev-parse', '--verify', '-q', 'HEAD']).status === 0 ? 'blocked' : null;`;

test('--branch diffs gitCalls per call and branchRules verdicts on an unborn and a born repo', () => {
  const cfg = config({ 's.jsonl': [bash('git commit -m x'), bash('for f in a; do git add f; done'), bash('ls')] });
  const lines = run(cfg, checkout('return null;', 'true', branchOld), checkout('return null;', 'true', branchNew), '--branch')
    .trim()
    .split('\n');
  assert.deepEqual(lines, [
    'gitCalls#1: {"sub":"add","args":[],"repo":"<repo>/sub"} -> {"sub":"add","args":[],"repo":"<repo>/other"} | for f in a; do git add f; done',
    'gitCalls#2: none -> {"sub":"add","args":[],"repo":"<repo>/sub"} | for f in a; do git add f; done',
    'branchRules[born]: allow -> BLOCK | git commit -m x',
    'summary: 3 changed; 3 commands, 0 answers from 1 files; --branch: 2 gitCalls, 1 branchRules over 6 probes (unborn + born)',
  ]);
});

test('each command replays under the tool that ran it, a command run by both once per tool', () => {
  // #171: the hook judges a ( … ) group or pipeline stage by its payload tool.
  const toolCo = checkout("return tool === 'PowerShell' && c === 'sc f x' ? 'blocked' : null;", 'true', `export const scrub = (c) => c;
export const gitCalls = (c, cwd, tool) => [{ sub: String(tool), args: [], repo: cwd }];
export const branchRules = (c, cwd, tool) => (tool === 'PowerShell' ? 'blocked' : null);`);
  const plainCo = checkout('return null;', 'true', `export const scrub = (c) => c;
export const gitCalls = (c, cwd) => [{ sub: 'Bash', args: [], repo: cwd }];
export const branchRules = () => null;`);
  const cfg = config({ 's.jsonl': [bash('git commit -m x'), bash('git commit -m x', 'PowerShell'), bash('sc f x'), bash('sc f x', 'PowerShell')] });
  const lines = run(cfg, plainCo, toolCo, '--branch').trim().split('\n');
  assert.deepEqual(lines, [
    'staticCheck: null -> "blocked" | sc f x',
    'gitCalls#0: {"sub":"Bash","args":[],"repo":"<repo>"} -> {"sub":"PowerShell","args":[],"repo":"<repo>"} | git commit -m x',
    'gitCalls#0: {"sub":"Bash","args":[],"repo":"<repo>"} -> {"sub":"PowerShell","args":[],"repo":"<repo>"} | sc f x',
    'branchRules[unborn]: allow -> BLOCK | git commit -m x',
    'branchRules[unborn]: allow -> BLOCK | sc f x',
    'branchRules[born]: allow -> BLOCK | git commit -m x',
    'branchRules[born]: allow -> BLOCK | sc f x',
    'summary: 7 changed; 4 commands, 0 answers from 1 files; --branch: 2 gitCalls, 4 branchRules over 8 probes (unborn + born)',
  ]);
});

test('gatedVerbs replays under the tool that ran each command; browserCommand (rule 9, cut by #368) is not replayed', () => {
  const toolCo = checkout('return null;', 'true', '', {
    gated: "(c, cwd, tool) => (tool === 'PowerShell' ? ['git push'] : [])",
    browser: "(c, cwd, tool) => (tool === 'PowerShell' ? 'playwright' : null)",
  });
  const cfg = config({ 's.jsonl': [bash('x'), bash('y', 'PowerShell')] });
  assert.deepEqual(run(cfg, checkout('return null;'), toolCo).trim().split('\n'), [
    'gatedVerbs: [] -> ["git push"] | y',
    'summary: 1 changed; 2 commands, 0 answers from 1 files',
  ]);
});

test('without --branch the stateful rules are not replayed', () => {
  const cfg = config({ 's.jsonl': [bash('git commit -m x'), bash('for f in a; do git add f; done')] });
  const out = run(cfg, checkout('return null;', 'true', branchOld), checkout('return null;', 'true', branchNew)).trim();
  assert.equal(out, 'summary: 0 changed; 2 commands, 0 answers from 1 files');
});

test('--full prints each changed command whole, redacted, with the new branchRules block reason', () => {
  // #168: a flip whose command ran past 120 chars could not be explained from the report.
  const long = `S=/scratch; cd $S/pr && GH_TOKEN=tok9 ${'x'.repeat(130)}\n  git commit -m tail-marker`;
  const why = `export const scrub = (c) => c;
export const gitCalls = () => [];`;
  const cfg = config({ 's.jsonl': [bash(long)] });
  const oldCo = checkout('return null;', 'true', `${why}\nexport const branchRules = () => null;`);
  const newCo = checkout('return null;', 'true', `${why}\nexport const branchRules = (c) => (c.includes('tail-marker') ? 'commit blocked: on main' : null);`);

  const short = run(cfg, oldCo, newCo, '--branch');
  assert.doesNotMatch(short, /tail-marker/, 'the default line still truncates');

  const lines = run(cfg, oldCo, newCo, '--branch', '--full').trim().split('\n');
  assert.deepEqual(lines.slice(1, 5), [
    '  command:',
    `    S=/scratch; cd $S/pr && GH_TOKEN=*** ${'x'.repeat(130)}`,
    '      git commit -m tail-marker',
    '  reason: "commit blocked: on main"',
  ]);
  assert.match(lines[0], /^branchRules\[unborn\]: allow -> BLOCK \| /);
  assert.equal(lines.filter((l) => l === '  command:').length, 2, 'unborn and born each get the block');
  assert.doesNotMatch(lines.join('\n'), /tok9/);
});

test('--full adds no reason line where the verdict is already printed whole', () => {
  const cfg = config({ 's.jsonl': [bash('git add -A')] });
  const out = run(cfg, checkout("return 'blocked';"), checkout('return null;'), '--full').trim().split('\n');
  assert.deepEqual(out.slice(0, 3), ['staticCheck: "blocked" -> null | git add -A', '  command:', '    git add -A']);
  assert.match(out[3], /^summary:/);
});

test('--branch redacts secrets in the printed gitCalls args too', () => {
  const argsCall = (dir) => `{ sub: 'remote', args: c.split(' ').slice(2), repo: cwd + '/${dir}' }`;
  const co = (dir) => checkout('return null;', 'true', `export const scrub = (c) => c;
export const gitCalls = (c, cwd) => [${argsCall(dir)}];
export const branchRules = () => null;`);
  const cfg = config({ 's.jsonl': [bash('git remote add o https://me:tok7@github.com/x GH_TOKEN=tok8')] });
  const out = run(cfg, co('a'), co('b'), '--branch');
  assert.doesNotMatch(out, /tok7|tok8/);
  assert.match(out, /https:\/\/me:\*\*\*@github\.com\/x/);
});

// ---- --by-rule (#368): live bash-guard blocks per rule, sorted true / false by a stated check ----

const repoRoot = join(dirname(script), '..');
const { classify, ruleOf, load } = await import(pathToFileURL(script).href);
const guard = await load(repoRoot);
const SHARED = 'C:/Users/u/code/shop';
const WT = 'C:/Users/u/code/.worktrees/shop-1-x';
const hookError = (reason, hook = 'bash-guard.mjs') => `PreToolUse:Bash hook error: [node "C:/u/claude-config/hooks/${hook}"]: ${reason}`;
let useId = 0;
/** A shell call and its result: `blocked` is a hook reason, `out` the output of an allowed call. */
function shell(command, { blocked = null, hook, out = 'ok', error = false, tool = 'Bash', cwd = SHARED, t = '2026-10-01T10:00:00.000Z', description } = {}) {
  const id = `toolu_${++useId}`;
  return [
    { type: 'assistant', timestamp: t, cwd, message: { content: [{ type: 'tool_use', id, name: tool, input: { command, description } }] } },
    { type: 'user', timestamp: t, cwd, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: Boolean(blocked) || error, content: blocked ? hookError(blocked, hook) : out }] } },
  ];
}
/** An AskUserQuestion call, as the transcript holds it. */
const askCall = (question, options = ['Yes', 'No']) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: `toolu_${++useId}`, name: 'AskUserQuestion', input: { questions: [{ question, options: options.map((label) => ({ label })) }] } }] },
});
const follow = (command, o = {}) => ({ kind: 'shell', cmd: command, tool: 'Bash', cwd: SHARED, blocked: false, result: 'ok', error: false, ...o });
const block = (rule, cmd, follows = [], o = {}) => ({ rule, reason: '', cmd, tool: 'Bash', cwd: SHARED, follow: follows, ...o });
const verdictOf = (b) => classify(b, guard).verdict;
const SINCE_FIXED = 'since fixed: the current rules no longer block it';

test('ruleOf maps current and retired bash-guard wordings to their rule', () => {
  const cases = [
    ["git add -A/--all is banned: shared repos carry concurrent sessions' in-flight files.", '1'],
    ['git add . is banned: shared repos …', '1'],
    ['git commit -a/--all is banned: …', '1'],
    ['Refusing to stage/commit a .env file (secrets).', '2'],
    ["A pipe after a gate reports the pipe's exit code, not the gate's. Run gates unpiped (use scripts/qa.mjs)", '3'],
    ['PowerShell Set-Content/Out-File/Add-Content mojibake UTF-8 text.', '4'],
    ['"C:\\Users\\u\\code\\shop" is on main — never commit to the default branch.', '5'],
    ["This git commit runs in a directory the guard can't resolve — …", '5'],
    ['No file restores on the claude-config main checkout: …', '6'],
    ['The claude-config main checkout is the live junction surface — it never leaves main.', '6'],
    ["No commits in the claude-config main checkout: it holds other sessions' uncommitted live edits, …", '6'],
    ["git add -A/--all is banned in a shared checkout: it carries concurrent sessions' in-flight files.", '1'],
    ['A shell-launched claude on "fable" is usage-billed and needs per-run user clearance', '7'],
    ["git push needs explicit user approval; neither the user's latest typed prompt …", '8'],
    ['gh pr merge already spent that approval — one push/PR per approving answer.', '8'],
    ['This command holds 2 gated verbs (git push, gh pr create) — run each …', '8'],
    ['This approval covers github.com/o/r#b. After its first call, …', '8'],
    ["This approval's PR (github.com/o/r#b) was merged, which used the approval up", '8'],
    ["playwright --headed opens a visible browser and needs the user's consent; …", '9'],
    ['A heredoc body holding a doubled backslash arrives with it collapsed to one', '10'],
    ['This writes into a session transcript (~/.claude/projects/**/*.jsonl) or an approval gate', '11'],
    ['This node/bun/deno eval script holds a backtick or `$(` the shell substitutes', '12'],
    ['This command nests blocks, groups or substitutions more than 100 levels deep', 'nesting'],
    ['bash-guard failed before it could check this action (boom) — this guard fails closed', 'crash'],
    ['something else entirely', 'other'],
  ];
  for (const [reason, rule] of cases) assert.equal(ruleOf(reason), rule, reason);
});

test('--by-rule counts each live bash-guard block once, from tool results only, and states its window', () => {
  const blockedAdd = shell('git add -A', { blocked: "git add -A/--all is banned: shared repos carry concurrent sessions' in-flight files." });
  const otherHook = shell('rm -rf x', { blocked: 'nope', hook: 'other-guard.mjs' });
  const later = shell('git status', { t: '2026-10-03T10:00:00.000Z' });
  // an api-request-blob record copies earlier messages: it is not a second block
  const blob = { type: 'api-request-blob', message: { content: [...blockedAdd[0].message.content, ...blockedAdd[1].message.content] } };
  const cfg = config({ 's.jsonl': [...blockedAdd, ...otherHook, blob, ...later] });
  const out = run(cfg, '--by-rule', repoRoot);
  assert.match(out, /^Window: 2026-10-01 → 2026-10-03 \(3 days\); 1 transcript files \(1 main, 0 subagent\); 3 Bash\/PowerShell calls; 1 live bash-guard blocks$/m);
  assert.match(out, /^\| 1 \| [^|]+ \| 1 \| 1 \| 0 \| 0 \| 1 \|$/m, 'rule 1: one live block, a true one (shared checkout, dropped), one replayed');
  assert.match(out, /^\| 2 \| [^|]+ \| 0 \| 0 \| 0 \| 0 \| 0 \|$/m, 'a zero-hit rule keeps its row');
});

test('--by-rule reads every transcript by default, not the last 7 days', () => {
  const old = shell('git add -A', { blocked: 'git add -A/--all is banned: …', t: '2026-01-01T10:00:00.000Z' });
  const cfg = config({ 'old.jsonl': old });
  utimesSync(join(cfg, 'projects', 'p', 'old.jsonl'), new Date('2026-01-02'), new Date('2026-01-02'));
  assert.match(run(cfg, '--by-rule', repoRoot), /; 1 live bash-guard blocks$/m);
});

test('a block the current rules no longer make is false: since fixed', () => {
  assert.deepEqual(classify(block('1', 'grep -n "git add -A" notes.md'), guard), { verdict: 'false', why: 'since fixed: the current rules no longer block it' });
});

test('rule 1: false in a worktree or for git add -N; true in a shared checkout the agent then staged by path', () => {
  assert.equal(verdictOf(block('1', 'git add -A', [follow('git add a.ts', { cwd: WT })], { cwd: WT })), 'false');
  assert.equal(verdictOf(block('1', 'git add -N .')), 'false');
  assert.equal(verdictOf(block('1', 'git add -A', [follow('git add a.ts b.ts')])), 'true');
  assert.equal(verdictOf(block('1', 'git add -A', [follow('git ls-files -m | xargs git add')])), 'false', 'a sweep by another route is a bypass');
});

test('a repo path with a tmp/ or temp/ segment is not a temp repo; the temp dir and a scratchpad are', () => {
  for (const cwd of ['C:/Users/u/code/web/tmp/site', 'C:/Users/u/code/temp/shop', '/home/u/code/app/tmp']) {
    assert.equal(verdictOf(block('1', 'git add -A', [follow('git add a.ts', { cwd })], { cwd })), 'true', cwd);
  }
  for (const cwd of [join(tmpdir(), 'gr-x'), '/tmp/probe', 'C:/Users/u/AppData/Local/Temp/probe', '/c/Users/u/AppData/Local/Temp/p', 'C:/Users/u/AppData/Local/Temp/claude/x/scratchpad/r']) {
    assert.equal(verdictOf(block('1', 'git add -A', [follow('git add a.ts', { cwd })], { cwd })), 'false', cwd);
  }
});

test('rule 3: the unpiped rerun of the gate decides — passed is false, failed is true, none is undecided', () => {
  const gate = 'cd /r && pnpm test 2>&1 | tail -5';
  const rerun = 'cd /r && pnpm test > "$T/log" 2>&1; echo rc=$?; tail -5 "$T/log"';
  assert.equal(verdictOf(block('3', gate, [follow(rerun, { result: 'rc=0\n✓ 12 passed' })])), 'false');
  assert.equal(verdictOf(block('3', gate, [follow(rerun, { result: 'rc=1\n✗ 1 failed' })])), 'true');
  assert.equal(verdictOf(block('3', gate, [follow('cd /r && pnpm test', { result: 'Exit code 1\nfailed', error: true })])), 'true');
  assert.equal(verdictOf(block('3', gate, [follow('ls')])), 'undecided');
  assert.equal(verdictOf(block('3', gate, [{ kind: 'ask' }, follow(rerun, { result: 'rc=0' })])), 'true', 'asking the user is a change of course');
});

test('rule 3: a rerun with extra flags, or through qa.mjs, is the same gate', () => {
  const gate = 'node --test scripts/test/a.test.mjs 2>&1 | tail -8';
  const flagged = 'node --test --test-reporter=dot scripts/test/a.test.mjs > "$T/l" 2>&1; echo rc=$?';
  assert.equal(verdictOf(block('3', gate, [follow(flagged, { result: 'rc=1' })])), 'true');
  assert.equal(verdictOf(block('3', gate, [follow('node scripts/qa.mjs .', { result: 'EXIT:0\nEXIT:0' })])), 'false');
  assert.equal(verdictOf(block('3', gate, [follow('node --test scripts/test/b.test.mjs; echo rc=$?', { result: 'rc=1' })])), 'undecided', 'another file is another gate');
});

test('rule 3: a rerun that was meant to fail — a TDD red step, a mutation run, a guard probe — is false, not true', () => {
  const gate = 'node --test scripts/test/a.test.mjs 2>&1 | tail -8';
  const rerun = 'node --test scripts/test/a.test.mjs > "$T/l" 2>&1; echo rc=$?';
  const expected = { verdict: 'false', why: 'no harm: the rerun was meant to fail (a TDD red step, a mutation run or a guard probe), so its rc hid nothing' };
  for (const description of [
    'Run the new test to confirm red',
    'TDD red step: expect the test to fail',
    'Mutation run: break isGate and expect failures',
    // new tests run against the code before the change: a red step by another name
    'Run new #264 tests against base hook copy',
    'Run #214 tests against main hook copy',
    'Run new tests against pre-gate script copy',
  ]) {
    assert.deepEqual(classify(block('3', gate, [follow(rerun, { result: 'rc=1', description })]), guard), expected, description);
  }
  assert.deepEqual(classify(block('3', gate, [follow(rerun.replace('--test', '--test --test-name-pattern=mutation'), { result: 'rc=1' })]), guard), expected, 'the gate segment says so');
  const probe = 'echo \'{"tool_input":{"command":"node --test scripts/test/a.test.mjs | tail"}}\' | node hooks/bash-guard.mjs; echo rc=$?';
  assert.deepEqual(classify(block('3', gate, [follow(probe, { result: 'rc=2' })]), guard), expected, 'a guard probe');
  // An ordinary failing rerun is still true, and a red step that passed is plain false.
  assert.equal(verdictOf(block('3', gate, [follow(rerun, { result: 'rc=1', description: 'Rerun the tests unpiped' })])), 'true');
  assert.equal(verdictOf(block('3', gate, [follow(rerun, { result: 'rc=0', description: 'Confirm red' })])), 'false');
});

test('rule 3: meant-to-fail is read off the rerun\'s own gate segment and a description that says the failure is expected', () => {
  const gate = 'node --test scripts/test/a.test.mjs 2>&1 | tail -8';
  const t = 'node --test scripts/test/a.test.mjs';
  const real = (cmd, o = {}) => verdictOf(block('3', gate, [follow(cmd, { result: 'rc=1', ...o })]));
  assert.equal(real(`${t} > "$T/l" 2>&1; echo rc=$?; git diff --stat hooks/bash-guard.mjs`), 'true', 'another clause names bash-guard.mjs');
  assert.equal(real(`${t} > "$T/l" 2>&1; echo rc=$?`, { description: 'Rerun the suite against main' }), 'true', 'against main alone is no red step');
  assert.equal(real(`node probe.mjs; ${t} > "$T/l" 2>&1; echo rc=$?`), 'true', 'another clause runs a probe');
  assert.equal(real(`${t} > "$T/l" 2>&1; echo rc=$?`, { description: 'Confirm red' }), 'false', 'a red step');
});

test('rule 3: a like call runs the same gate, or qa.mjs run for its gates, in the block\'s directory', () => {
  const gate = 'node --test scripts/test/a.test.mjs 2>&1 | tail -8';
  assert.equal(verdictOf(block('3', gate, [follow('node scripts/qa.mjs --help', { result: 'EXIT:1' })])), 'undecided', '--help runs no gate');
  assert.equal(verdictOf(block('3', gate, [follow('node scripts/qa.mjs .', { result: 'EXIT:1', cwd: WT })])), 'undecided', 'another directory');
  assert.equal(verdictOf(block('3', gate, [follow('node scripts/qa.mjs .', { result: 'EXIT:1' })])), 'true');
});

test('rule 3: a question about an unrelated gate is not asked about the block', () => {
  const gate = 'cd /r && pnpm test 2>&1 | tail -5';
  const rerun = 'cd /r && pnpm test > "$T/log" 2>&1; echo rc=$?';
  const ask = (text) => ({ kind: 'ask', text });
  assert.equal(verdictOf(block('3', gate, [follow('ls'), ask('Approve the push gate?'), follow(rerun, { result: 'rc=0' })])), 'false');
  assert.equal(verdictOf(block('3', gate, [follow('ls'), ask('Run cd /r && pnpm test myself?'), follow(rerun, { result: 'rc=0' })])), 'true', 'names the gate command');
});

test('rule 3: the rc is the marker echoed right after the gate, never the worst of unrelated ones', () => {
  const gate = 'cd /r && pnpm test 2>&1 | tail -5';
  const two = 'cd /r && pnpm test > "$T/log" 2>&1; echo rc=$?; node scripts/other.mjs; echo exit=$?';
  assert.equal(verdictOf(block('3', gate, [follow(two, { result: 'rc=0\nexit=1' })])), 'false', 'the gate passed; the other script failed');
  assert.equal(verdictOf(block('3', gate, [follow(two, { result: 'rc=1\nexit=0' })])), 'true');
  const labelled = 'cd /r && pnpm test > "$T/log" 2>&1; echo "tests EXIT:$?"; pnpm lint > "$T/l2" 2>&1; echo "lint EXIT:$?"';
  assert.equal(verdictOf(block('3', gate, [follow(labelled, { result: 'lint EXIT:1\ntests EXIT:0' })])), 'false');
  // No marker after the gate: Claude Code's exit code is the last command's, so it counts only when the gate ran last.
  assert.equal(verdictOf(block('3', gate, [follow('cd /r && pnpm test > "$T/log" 2>&1; cat "$T/log"', { result: 'Exit code 1\nx', error: true })])), 'undecided');
  assert.equal(verdictOf(block('3', gate, [follow('cd /r && pnpm test', { result: 'Exit code 1\nx', error: true })])), 'true');
});

test('an AskUserQuestion counts as asked only when it is the next call or names the blocked act', () => {
  const gate = 'cd /r && pnpm test 2>&1 | tail -5';
  const rerun = 'cd /r && pnpm test > "$T/log" 2>&1; echo rc=$?';
  const ask = (text) => ({ kind: 'ask', text });
  assert.equal(verdictOf(block('3', gate, [follow('ls'), ask('Which colour for the badge?'), follow(rerun, { result: 'rc=0' })])), 'false', 'an unrelated question later is not about the block');
  assert.equal(verdictOf(block('3', gate, [follow('ls'), ask('The guard blocked the piped gate; rerun it unpiped?'), follow(rerun, { result: 'rc=0' })])), 'true');
  assert.equal(verdictOf(block('3', gate, [ask('Which colour for the badge?'), follow(rerun, { result: 'rc=0' })])), 'true', 'the next call');
  const repo = mainRepo();
  asConfigRepo(repo, () => {
    const restore = `git -C ${repo} checkout -- a.md`;
    assert.equal(verdictOf(block('6', restore, [follow('ls'), ask('Discard the edit to a.md with git restore?')])), 'true');
    assert.equal(verdictOf(block('6', restore, [follow('ls'), ask('Which colour?'), follow(`git -C ${repo} checkout -- a.md b.md`)])), 'undecided');
  });
});

test('--by-rule reads each call description and AskUserQuestion text from the transcript', () => {
  const blocked = shell('node --test scripts/test/a.test.mjs 2>&1 | tail -8', { blocked: "A pipe after a gate reports the pipe's exit code, not the gate's." });
  const red = shell('node --test scripts/test/a.test.mjs > "$T/l" 2>&1; echo rc=$?', { out: 'rc=1', description: 'TDD red: confirm the new test fails' });
  const cfg = config({ 's.jsonl': [...blocked, ...red] });
  assert.match(run(cfg, '--by-rule', repoRoot), /^\| 3 \| [^|]+ \| 1 \| 0 \| 1 \| 0 \| \d+ \|$/m, 'a red step is false');
  const later = shell('node --test scripts/test/a.test.mjs > "$T/l" 2>&1; echo rc=$?', { out: 'rc=1' });
  const asked = config({ 's.jsonl': [...blocked, ...shell('ls'), askCall('Ship the pipe-free rerun?'), ...later] });
  assert.match(run(asked, '--by-rule', repoRoot), /^\| 3 \| [^|]+ \| 1 \| 1 \| 0 \| 0 \| \d+ \|$/m);
});

test('rule 4: Out-File writes UTF-16 or a BOM on Windows PowerShell; ASCII-only Set-Content mangles nothing', () => {
  assert.equal(verdictOf(block('4', 'gh issue view 1 | Out-File x.txt', [], { tool: 'PowerShell' })), 'true');
  assert.equal(verdictOf(block('4', 'Set-Content keep.txt "x"', [], { tool: 'PowerShell' })), 'false');
});

/** A checkout whose branchRules still has rule 5 (cut by #368): a commit blocks. A by-rule
 *  run over an older checkout judges rule 5's blocks this way. */
const withRule5 = { ...guard, branchRules: (c) => (/\bcommit\b/.test(c) ? '"C:\\Users\\u\\code\\shop" is on main — never commit to the default branch.' : null) };
const verdict5 = (b) => classify(b, withRule5).verdict;

test('rule 5 is cut: under the current rules every rule-5 block is false, since fixed', () => {
  const r = '"C:\\Users\\u\\code\\shop" is on main — never commit to the default branch.';
  assert.deepEqual(classify(block('5', 'git commit -m x', [follow(`cd ${WT} && git commit -m x`)], { reason: r }), guard), { verdict: 'false', why: SINCE_FIXED });
});

test('rule 5 (an older checkout): docs subtrees and temp repos are no harm; a rename back to main is a bypass; a worktree commit is the remedy', () => {
  const onMain = (p) => `"${p}" is on main — never commit to the default branch.`;
  assert.equal(verdict5(block('5', 'git commit -m x', [], { reason: onMain('C:\\Users\\u\\code\\docs\\games\\notes') })), 'false');
  assert.equal(verdict5(block('5', 'git commit -m x', [], { reason: onMain('C:/Users/u/AppData/Local/Temp/probe') })), 'false');
  const r = onMain('C:\\Users\\u\\code\\shop');
  assert.equal(verdict5(block('5', 'git commit -m x', [follow('git switch -c tmp && git commit -m x && git branch -m tmp main')], { reason: r })), 'false');
  assert.equal(verdict5(block('5', 'git commit -m x', [follow(`cd ${WT} && git commit -m x`)], { reason: r })), 'true');
  const unknown = "This git commit runs in a directory the guard can't resolve — …";
  assert.equal(verdict5(block('5', 'cd $W && git commit -m x', [follow(`git -C ${WT} commit -m x`)], { reason: unknown })), 'false', 'the unresolved dir was a worktree');
});

/** A temp repo on main with one commit. */
function mainRepo() {
  const repo = tempDir('gr-main-');
  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'init');
  return repo;
}
/** Runs fn with CLAUDE_CONFIG_REPO (rule 6's main checkout) pointed at `repo`. */
function asConfigRepo(repo, fn) {
  const prev = process.env.CLAUDE_CONFIG_REPO;
  process.env.CLAUDE_CONFIG_REPO = repo;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_REPO;
    else process.env.CLAUDE_CONFIG_REPO = prev;
  }
}
test('rules 5 and 6 replay through the checkout\'s rules while the repo is on the branch the block names', () => {
  const repo = mainRepo();
  const reason = `"${repo}" is on main — never commit to the default branch.`;
  assert.equal(classify(block('5', `git -C ${repo} status`, [], { reason }), withRule5).why, SINCE_FIXED);
  assert.equal(classify(block('5', `git -C ${repo} commit -m x`, [], { reason }), withRule5).why, 'no harm: a temp repo', 'still blocked: judged on');
  const elsewhere = `"${repo}" is on master — never commit to the default branch.`;
  assert.notEqual(classify(block('5', `git -C ${repo} status`, [], { reason: elsewhere }), withRule5).why, SINCE_FIXED, 'another branch now: not replayed');
  asConfigRepo(repo, () => {
    assert.equal(classify(block('6', `git -C ${repo} status`), guard).why, SINCE_FIXED);
    assert.notEqual(classify(block('6', `git -C ${repo} checkout -- a.md`), guard).why, SINCE_FIXED);
  });
});

test('a rephrase whose harm the check cannot decide is undecided; dropping the action is true', () => {
  const repo = mainRepo();
  const restore = `git -C ${repo} checkout -- a.md`;
  asConfigRepo(repo, () => {
    assert.equal(verdictOf(block('6', restore, [follow(`git -C ${repo} checkout -- a.md b.md`)])), 'undecided');
    assert.equal(verdictOf(block('6', restore, [follow('ls')])), 'true');
  });
});

test('rules out of scope or already removed are counted, never sorted', () => {
  for (const rule of ['8', '10', '11', 'other']) assert.equal(verdictOf(block(rule, 'git push')), null, rule);
});

test('--by-rule lists each undecided block with its command, and --full lists every block', () => {
  const rows = [...shell('git checkout -- a.md', { blocked: 'No file restores on the claude-config main checkout: …' }), ...shell('git checkout -- a.md b.md')];
  const cfg = config({ 's.jsonl': rows });
  const out = run(cfg, '--by-rule', repoRoot);
  assert.match(out, /^## Undecided \(1\)$/m);
  assert.match(out, /^- rule 6 · 2026-10-01 · .+ · `git checkout -- a\.md`$/m);
  assert.doesNotMatch(out, /^## Every block/m);
  assert.match(run(cfg, '--by-rule', repoRoot, '--full'), /^## Every block \(1\)$/m);
});

test('--by-rule replays the current static rules over every unique command, blocked live or not', () => {
  const cfg = config({ 's.jsonl': [...shell('pnpm test | tail -3'), ...shell('pnpm test | tail -3'), ...shell('ls')] });
  assert.match(run(cfg, '--by-rule', repoRoot), /^\| 3 \| [^|]+ \| 0 \| 0 \| 0 \| 0 \| 1 \|$/m);
});
