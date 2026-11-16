// node --test scripts/test/guard-replay.test.mjs — guard-replay over a fixture
// transcript and two tiny fake checkouts whose staticCheck differs on one command.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { execHarness, tempDir } from './_spawn.mjs';
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
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

// ---- --body-edits (#388): count past `gh issue edit --body/--body-file` calls ----
// Pinned output (markdown, stdout, rc 0):
//   # Past issue-body edits
//   Window: <first> → <last> (<n> days); <n> transcript files (<m> main, <s> subagent); <n> Bash/PowerShell calls
//   - Body-edit calls: N
//   - Unique commands: N
//   - Sessions: N
//   - Issue targets: N
//   --full adds `## Every unique command (N)` then each command redacted and indented 4 spaces.

const edits = (cfg, ...args) => run(cfg, '--body-edits', repoRoot, ...args);
const tally = (out) => Object.fromEntries([...out.matchAll(/^- (Body-edit calls|Unique commands|Sessions|Issue targets): (\d+)$/gm)].map((m) => [m[1], Number(m[2])]));

test('--body-edits counts every body-edit flag shape, across bash -c and the PowerShell tool', () => {
  const rows = [
    ...shell('gh issue edit 1 --body "new text"'),
    ...shell('gh issue edit 2 --body-file notes.md'),
    ...shell('gh issue edit 3 -F notes.md'),
    ...shell('gh issue edit 4 -b "short"'),
    ...shell('gh issue edit 5 --body=inline'),
    ...shell('gh issue edit 6 --body-file=notes.md'),
    ...shell('bash -c "gh issue edit 7 --body x"'),
    ...shell('gh issue edit 8 --body x', { tool: 'PowerShell' }),
  ];
  const out = edits(config({ 's.jsonl': rows }));
  assert.match(out, /^# Past issue-body edits$/m);
  assert.match(out, /^Window: 2026-10-01 → 2026-10-01 \(1 days?\); 1 transcript files \(1 main, 0 subagent\); 8 Bash\/PowerShell calls$/m);
  assert.deepEqual(tally(out), { 'Body-edit calls': 8, 'Unique commands': 8, Sessions: 1, 'Issue targets': 8 });
});

test('--body-edits counts a repeated command twice but lists it once, and counts sessions and targets distinctly', () => {
  const same = 'gh issue edit 5 --body-file notes.md';
  const other = 'gh issue edit 7 -R o/r -F f.md';
  const cfg = config({
    'a.jsonl': [...shell(same), ...shell(same)],
    'b.jsonl': [...shell(other)],
  });
  const out = edits(cfg);
  assert.match(out, /; 2 transcript files \(2 main, 0 subagent\); 3 Bash\/PowerShell calls$/m);
  assert.deepEqual(tally(out), { 'Body-edit calls': 3, 'Unique commands': 2, Sessions: 2, 'Issue targets': 2 });
});

test('--body-edits leaves out edits without a body flag, comments, PR edits and mentions inside other commands', () => {
  const rows = [
    ...shell('gh issue edit 5 --add-label x'),
    ...shell('gh issue comment 5 --body x'),
    ...shell('gh pr edit 5 --body x'),
    ...shell('grep "gh issue edit --body" notes.md'),
    ...shell('gh issue view 5 --json body'),
  ];
  const out = edits(config({ 's.jsonl': rows }));
  assert.deepEqual(tally(out), { 'Body-edit calls': 0, 'Unique commands': 0, Sessions: 0, 'Issue targets': 0 });
});

test('--body-edits counts only the body edits among other commands in the same transcript', () => {
  const rows = [...shell('gh issue edit 5 --add-label x'), ...shell('gh issue edit 5 --body x'), ...shell('ls')];
  const out = edits(config({ 's.jsonl': rows }));
  assert.match(out, /; 3 Bash\/PowerShell calls$/m);
  assert.deepEqual(tally(out), { 'Body-edit calls': 1, 'Unique commands': 1, Sessions: 1, 'Issue targets': 1 });
});

test('--body-edits reads every transcript by default, not the last 7 days, and honours --files', () => {
  const old = shell('gh issue edit 5 --body x', { t: '2026-01-01T10:00:00.000Z' });
  const cfg = config({ 'old.jsonl': old });
  utimesSync(join(cfg, 'projects', 'p', 'old.jsonl'), new Date('2026-01-02'), new Date('2026-01-02'));
  assert.equal(tally(edits(cfg))['Body-edit calls'], 1);
  const two = config({ 'a.jsonl': shell('gh issue edit 5 --body x'), 'b.jsonl': shell('gh issue edit 6 --body y') });
  utimesSync(join(two, 'projects', 'p', 'a.jsonl'), new Date('2026-01-02'), new Date('2026-01-02'));
  const narrowed = edits(two, '--files', '1');
  assert.match(narrowed, /; 1 transcript files /);
  assert.equal(tally(narrowed)['Body-edit calls'], 1);
});

test('--body-edits lists each unique command only under --full, redacted and indented', () => {
  const cfg = config({ 's.jsonl': [...shell('gh issue edit 5 --body x'), ...shell('gh issue edit 5 --body x'), ...shell('gh issue edit 6 --body-file n.md')] });
  const plain = edits(cfg);
  assert.doesNotMatch(plain, /^## Every unique command/m);
  const full = edits(cfg, '--full');
  assert.match(full, /^## Every unique command \(2\)$/m);
  assert.match(full, /^ {4}gh issue edit 5 --body x$/m);
  assert.match(full, /^ {4}gh issue edit 6 --body-file n\.md$/m);
  assert.equal(full.match(/^ {4}gh issue edit 5 --body x$/gm).length, 1, 'listed once');
  const secret = config({ 's.jsonl': shell('GH_TOKEN=hunter2secret gh issue edit 5 --body x') });
  assert.doesNotMatch(edits(secret, '--full'), /hunter2secret/);
  assert.equal(tally(edits(secret))['Body-edit calls'], 1, 'an env prefix still counts');
});

// ---- --body-edits fix round 1 (#388 review findings) ----

test('--body-edits finding 1: a global -R before the subcommand does not collapse distinct targets', () => {
  const rows = [...shell('gh -R o/r issue edit 5 --body x'), ...shell('gh -R o/r issue edit 6 --body x'), ...shell('gh -R o/r issue edit 7 --body x')];
  const out = edits(config({ 's.jsonl': rows }));
  assert.deepEqual(tally(out), { 'Body-edit calls': 3, 'Unique commands': 3, Sessions: 1, 'Issue targets': 3 });
});

test('--body-edits finding 1: -R between `issue` and `edit` targets the same issue as -R after the number', () => {
  const rows = [...shell('gh issue -R o/r edit 5 --body x'), ...shell('gh issue edit 5 -R o/r --body x')];
  const out = edits(config({ 's.jsonl': rows }));
  assert.deepEqual(tally(out), { 'Body-edit calls': 2, 'Unique commands': 2, Sessions: 1, 'Issue targets': 1 });
});

test('--body-edits finding 2: a checkout argument without hooks/bash-guard.mjs fails loudly instead of reporting on the script own checkout', () => {
  const cfg = config({ 's.jsonl': shell('gh issue edit 5 --body x') });
  let failed = null;
  let out = '';
  try {
    out = execHarness(script, ['--body-edits', 'C:/nonexistent/checkout'], { env: { CLAUDE_CONFIG_DIR: cfg } });
  } catch (e) {
    failed = e;
  }
  assert.ok(failed, `expected a non-zero exit for a missing checkout, got a report:\n${out}`);
  assert.match(failed.stderr, /\S/, 'an error is written to stderr');
});

test('--body-edits finding 4: several issue numbers in one edit are several targets', () => {
  const out = edits(config({ 's.jsonl': shell('gh issue edit 5 6 --body x') }));
  assert.deepEqual(tally(out), { 'Body-edit calls': 1, 'Unique commands': 1, Sessions: 1, 'Issue targets': 2 });
});

test('--body-edits finding 5: attached short forms -bfoo and -Ffile.md count as body edits', () => {
  const rows = [...shell('gh issue edit 5 -bfoo'), ...shell('gh issue edit 6 -Ffile.md')];
  const out = edits(config({ 's.jsonl': rows }));
  assert.deepEqual(tally(out), { 'Body-edit calls': 2, 'Unique commands': 2, Sessions: 1, 'Issue targets': 2 });
});

test('--body-edits finding 6: two tool_use records without an id each count', () => {
  const noId = (command) => ({ type: 'assistant', timestamp: '2026-10-01T10:00:00.000Z', cwd: SHARED, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
  const out = edits(config({ 's.jsonl': [noId('gh issue edit 5 --body x'), noId('gh issue edit 5 --body x')] }));
  assert.equal(tally(out)['Body-edit calls'], 2);
});

// ---- --body-edits fix round 2 (#388 R1, R3) ----

for (const [label, command] of [
  ['>/dev/null', 'gh issue edit 5 --body x >/dev/null'],
  ['> /dev/null 2>&1', 'gh issue edit 5 --body x > /dev/null 2>&1'],
  ['2>&1', 'gh issue edit 5 --body x 2>&1'],
  ['< in.txt', 'gh issue edit 5 --body x < in.txt'],
]) {
  test(`--body-edits R1: a redirection (${label}) is not an issue target`, () => {
    const out = edits(config({ 's.jsonl': shell(command) }));
    assert.deepEqual(tally(out), { 'Body-edit calls': 1, 'Unique commands': 1, Sessions: 1, 'Issue targets': 1 });
  });
}

test('--body-edits R1: a $n placeholder still counts as a target', () => {
  const out = edits(config({ 's.jsonl': shell('gh issue edit $n --body x >/dev/null') }));
  assert.deepEqual(tally(out), { 'Body-edit calls': 1, 'Unique commands': 1, Sessions: 1, 'Issue targets': 1 });
});

test("--body-edits R3: a quoted '#5', 5 and an issue URL with -R o/r are one target", () => {
  const rows = [
    ...shell("gh issue edit '#5' -R o/r --body x"),
    ...shell('gh issue edit 5 -R o/r --body x'),
    ...shell('gh issue edit https://github.com/o/r/issues/5 -R o/r --body x'),
  ];
  const out = edits(config({ 's.jsonl': rows }));
  assert.deepEqual(tally(out), { 'Body-edit calls': 3, 'Unique commands': 3, Sessions: 1, 'Issue targets': 1 });
});

test('--body-edits R3: an unquoted #5 starts a shell comment, so it is no target (as in bash and rule 13)', () => {
  const out = edits(config({ 's.jsonl': shell('gh issue edit #5 --body x') }));
  assert.equal(tally(out)['Issue targets'], 0);
  const tail = edits(config({ 's.jsonl': shell('gh issue edit 7 --body x # tick #9') }));
  assert.deepEqual(tally(tail), { 'Body-edit calls': 1, 'Unique commands': 1, Sessions: 1, 'Issue targets': 1 });
});

test('--body-edits R3: an attached -Ro/r keys the same target as -R o/r', () => {
  const rows = [...shell('gh issue edit 5 -Ro/r --body x'), ...shell('gh issue edit 5 -R o/r --body x')];
  const out = edits(config({ 's.jsonl': rows }));
  assert.deepEqual(tally(out), { 'Body-edit calls': 2, 'Unique commands': 2, Sessions: 1, 'Issue targets': 1 });
});

// ---- --body-edits: target counts follow gh's flag arity (#388 review) ----

test('--body-edits: a relationship or type flag value is not an issue target', () => {
  for (const flag of ['--type bug', '--parent 99', '--add-blocked-by 13', '--remove-blocked-by 13', '--add-blocking 13', '--remove-blocking 13', '--add-sub-issue 13', '--remove-sub-issue 13']) {
    const out = edits(config({ 's.jsonl': shell(`gh issue edit 12 ${flag} --body x`) }));
    assert.deepEqual(tally(out), { 'Body-edit calls': 1, 'Unique commands': 1, Sessions: 1, 'Issue targets': 1 }, flag);
  }
});

test('--body-edits: --remove-milestone is a switch, so the number after it is a target', () => {
  const out = edits(config({ 's.jsonl': [...shell('gh issue edit --remove-milestone 12 --body x'), ...shell('gh issue edit 13 --remove-milestone --body x')] }));
  assert.deepEqual(tally(out), { 'Body-edit calls': 2, 'Unique commands': 2, Sessions: 1, 'Issue targets': 2 });
});

// ---- --prefixes (#420): count past calls that ran a command through command/exec/builtin/env ----
// Pinned output (markdown, stdout, rc 0):
//   # <title naming prefixes>
//   Window: <first> → <last> (<n> days); ... <n> Bash/PowerShell calls
//   - Prefixed calls: N
//   - Unique prefixed commands: N
//   - On a guarded verb: N
//   - Sessions: N
//   - By prefix: command N, exec N, builtin N, env N
//   --full adds each unique prefixed command, redacted, indented 4 spaces, guarded ones marked.

const prefixes = (cfg, ...args) => run(cfg, '--prefixes', repoRoot, ...args);
const pTally = (out) => Object.fromEntries([...out.matchAll(/^- (Prefixed calls|Unique prefixed commands|On a guarded verb|Sessions): (\d+)$/gm)].map((m) => [m[1], Number(m[2])]));
const byPrefix = (out) => {
  const m = /^- By prefix: command (\d+), exec (\d+), builtin (\d+), env (\d+)$/m.exec(out);
  return m ? { command: Number(m[1]), exec: Number(m[2]), builtin: Number(m[3]), env: Number(m[4]) } : null;
};
const P = (calls, unique, guarded, sessions) => ({ 'Prefixed calls': calls, 'Unique prefixed commands': unique, 'On a guarded verb': guarded, Sessions: sessions });

test('--prefixes prints the title, the window line and the five summary lines', () => {
  const out = prefixes(config({ 's.jsonl': [...shell('command ls'), ...shell('ls')] }));
  assert.match(out, /^# .*prefix/im);
  assert.match(out, /^Window: 2026-10-01 → 2026-10-01 \(1 days?\); 1 transcript files \(1 main, 0 subagent\); 2 Bash\/PowerShell calls$/m);
  assert.deepEqual(pTally(out), P(1, 1, 0, 1));
  assert.deepEqual(byPrefix(out), { command: 1, exec: 0, builtin: 0, env: 0 });
});

test('--prefixes counts each of command, exec, builtin and env, by basename, case and .exe', () => {
  const rows = [...shell('command ls'), ...shell('exec ls'), ...shell('builtin echo hi'), ...shell('env ls'), ...shell('/usr/bin/env FOO=1 ls'), ...shell('ENV.EXE ls'), ...shell('Command ls')];
  const out = prefixes(config({ 's.jsonl': rows }));
  assert.deepEqual(pTally(out), P(7, 7, 0, 1));
  assert.deepEqual(byPrefix(out), { command: 2, exec: 1, builtin: 1, env: 3 });
});

test('--prefixes reads the command word after leading VAR=value assignments and in any clause', () => {
  const rows = [...shell('FOO=1 BAR=2 command ls'), ...shell('cd /tmp && builtin cd /'), ...shell('ls; exec true')];
  const out = prefixes(config({ 's.jsonl': rows }));
  assert.deepEqual(pTally(out), P(3, 3, 0, 1));
  assert.deepEqual(byPrefix(out), { command: 1, exec: 1, builtin: 1, env: 0 });
});

test('--prefixes does not count a prefix word inside a quote, as an argument or as a find -exec', () => {
  const rows = [
    ...shell('echo "command git push"'),
    ...shell('find . -exec rm {} \\;'),
    ...shell("grep 'env git push' notes.md"),
    ...shell('git log --grep=exec'),
    ...shell('ls env'),
    ...shell('git status'),
  ];
  const out = prefixes(config({ 's.jsonl': rows }));
  assert.match(out, /; 6 Bash\/PowerShell calls$/m);
  assert.deepEqual(pTally(out), P(0, 0, 0, 0));
  assert.deepEqual(byPrefix(out), { command: 0, exec: 0, builtin: 0, env: 0 });
});

test('--prefixes counts `command -v git` as prefixed but not as guarded', () => {
  const out = prefixes(config({ 's.jsonl': shell('command -v git') }));
  assert.deepEqual(pTally(out), P(1, 1, 0, 1));
});

test('--prefixes marks a prefixed call guarded on a gated verb, a body edit or a static-check reason', () => {
  const rows = [
    ...shell('env git push origin x'),
    ...shell('env gh issue edit 1 --body x'),
    ...shell('env git add -A'),
    ...shell('env ls'),
    ...shell('command -v git'),
  ];
  const out = prefixes(config({ 's.jsonl': rows }));
  assert.deepEqual(pTally(out), P(5, 5, 3, 1));
  assert.deepEqual(byPrefix(out), { command: 1, exec: 0, builtin: 0, env: 4 });
});

test('--prefixes does not count an unprefixed guarded call as guarded-prefixed', () => {
  const out = prefixes(config({ 's.jsonl': [...shell('git push origin x'), ...shell('gh issue edit 1 --body x'), ...shell('env ls')] }));
  assert.deepEqual(pTally(out), P(1, 1, 0, 1));
});

test('--prefixes counts a repeated command twice but lists it once, and counts sessions', () => {
  const cfg = config({
    'a.jsonl': [...shell('env git push origin x'), ...shell('env git push origin x')],
    'b.jsonl': [...shell('command ls')],
    'c.jsonl': [...shell('ls')],
  });
  const out = prefixes(cfg);
  assert.match(out, /; 3 transcript files \(3 main, 0 subagent\); 4 Bash\/PowerShell calls$/m);
  assert.deepEqual(pTally(out), P(3, 2, 2, 2));
});

test('--prefixes counts a tool_use id once across a transcript and a subagent transcript, and reads both', () => {
  const dup = [{ type: 'assistant', timestamp: '2026-10-01T10:00:00.000Z', cwd: SHARED, message: { content: [{ type: 'tool_use', id: 'toolu_same', name: 'Bash', input: { command: 'command ls' } }] } }];
  const cfg = config({ 'main.jsonl': [...dup, ...dup, ...shell('env ls')] });
  const sub = join(cfg, 'projects', 'p', 'main', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-1.jsonl'), shell('exec ls').map((r) => JSON.stringify(r)).join('\n') + '\n');
  const out = prefixes(cfg);
  assert.match(out, /; 2 transcript files \(1 main, 1 subagent\); 3 Bash\/PowerShell calls$/m);
  assert.deepEqual(pTally(out), P(3, 3, 0, 2));
  assert.deepEqual(byPrefix(out), { command: 1, exec: 1, builtin: 0, env: 1 });
});

test('--prefixes counts the PowerShell tool and keeps one command run by both tools as two calls, one listed command per tool', () => {
  const rows = [...shell('env ls', { tool: 'PowerShell' }), ...shell('env ls')];
  assert.deepEqual(pTally(prefixes(config({ 's.jsonl': rows }))), P(2, 2, 0, 1));
});

test('--prefixes reads every transcript by default, not the last 7 days, and honours --files', () => {
  const cfg = config({ 'old.jsonl': shell('command ls', { t: '2026-01-01T10:00:00.000Z' }) });
  utimesSync(join(cfg, 'projects', 'p', 'old.jsonl'), new Date('2026-01-02'), new Date('2026-01-02'));
  assert.equal(pTally(prefixes(cfg))['Prefixed calls'], 1);
  const two = config({ 'a.jsonl': shell('command ls'), 'b.jsonl': shell('env ls') });
  utimesSync(join(two, 'projects', 'p', 'a.jsonl'), new Date('2026-01-02'), new Date('2026-01-02'));
  const narrowed = prefixes(two, '--files', '1');
  assert.match(narrowed, /; 1 transcript files /);
  assert.equal(pTally(narrowed)['Prefixed calls'], 1);
});

test('--prefixes lists each unique prefixed command only under --full, redacted, indented, guarded ones marked', () => {
  const cfg = config({ 's.jsonl': [...shell('env git push origin x'), ...shell('env git push origin x'), ...shell('command ls'), ...shell('ls')] });
  const plain = prefixes(cfg);
  assert.doesNotMatch(plain, /^ {4}env git push/m);
  const full = prefixes(cfg, '--full');
  assert.match(full, /^ {4}env git push origin x/m);
  assert.match(full, /^ {4}command ls/m);
  assert.equal(full.match(/^ {4}env git push origin x/gm).length, 1, 'listed once');
  assert.doesNotMatch(full, /^ {4}ls$/m, 'an unprefixed command is not listed');
  const pushLine = full.split('\n').find((l) => /^ {4}env git push origin x/.test(l));
  const lsLine = full.split('\n').find((l) => /^ {4}command ls/.test(l));
  assert.match(pushLine, /guarded/i);
  assert.doesNotMatch(lsLine, /guarded/i);
  const secret = config({ 's.jsonl': shell('GH_TOKEN=hunter2secret env ls') });
  assert.doesNotMatch(prefixes(secret, '--full'), /hunter2secret/);
  assert.equal(pTally(prefixes(secret))['Prefixed calls'], 1, 'an assignment before env still counts');
});

test('--prefixes reads the checkout it is given: a checkout without hooks/bash-guard.mjs fails loudly', () => {
  const cfg = config({ 's.jsonl': shell('command ls') });
  let failed = null;
  let out = '';
  try {
    out = execHarness(script, ['--prefixes', 'C:/nonexistent/checkout'], { env: { CLAUDE_CONFIG_DIR: cfg } });
  } catch (e) {
    failed = e;
  }
  assert.ok(failed, `expected a non-zero exit for a missing checkout, got a report:\n${out}`);
  assert.match(failed.stderr, /\S/, 'an error is written to stderr');
});

test('--prefixes counts a prefix in a later pipeline stage, behind another prefix, after a keyword or in a group', () => {
  // Known lower bound: a prefix inside `bash -c "..."` or `$(...)` is not counted (not pinned either way).
  const rows = [
    ...shell('cat a | command git push origin x'),
    ...shell('timeout 60 env FOO=1 git push origin x'),
    ...shell('nohup exec git push origin x'),
    ...shell('time command ls'),
    ...shell('if command -v node; then echo y; fi'),
    ...shell('(command ls)'),
  ];
  const out = prefixes(config({ 's.jsonl': rows }));
  assert.deepEqual(pTally(out), P(6, 6, 3, 1));
});

test('the guard-replay header comment documents --prefixes', () => {
  const head = readFileSync(script, 'utf8').split('\n').slice(0, 40).join('\n');
  assert.match(head, /--prefixes/);
  assert.match(head, /#420/);
});
