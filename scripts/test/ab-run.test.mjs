// node --test scripts/test/ab-run.test.mjs
// #271 A/B runner, the live path (runRound) end to end through the AB_CLAUDE_BIN seam: a fake claude
// reports what a session could see (the fix commit, remotes, credentials, CLAUDE.md, skills, settings,
// its home and temp) and edits the checkout, against a fixture claude-config repo under a temp home.
// No model runs.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedEnv, spawnHarness, tempDir } from './_spawn.mjs';
import { barrierEnv, childEnv, roundLayout } from '../ab/ab-lib.mjs';
import { TOKEN_PLACEHOLDER } from '../ab/round.mjs';

const RUN = join(dirname(fileURLToPath(import.meta.url)), '..', 'ab', 'run.mjs');
const GRADE = join(dirname(RUN), 'grade.mjs');
const hasGh = spawnSync('gh', ['--version']).status === 0;

const home = tempDir('ab-run-');
const env = isolatedEnv(home);

function put(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const FAKE = `
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const cwd = process.cwd();
const cfg = process.env.CLAUDE_CONFIG_DIR;
const e = process.env;
const ancestors = [];
for (let d = dirname(cwd); ; d = dirname(d)) { if (existsSync(join(d, 'CLAUDE.md'))) ancestors.push(join(d, 'CLAUDE.md')); if (dirname(d) === d) break; }
writeFileSync(e.AB_FAKE_REPORT, JSON.stringify({
  argv: process.argv.slice(2), prompt: readFileSync(0, 'utf8'), cwd, home: e.HOME, userprofile: e.USERPROFILE, cfg,
  homeDrivePath: (e.HOMEDRIVE ?? '') + (e.HOMEPATH ?? ''), appData: e.APPDATA, localAppData: e.LOCALAPPDATA, temp: e.TEMP, tmp: e.TMP, tmpdir: e.TMPDIR,
  dirsExist: [e.APPDATA, e.LOCALAPPDATA, e.TEMP].every((d) => existsSync(d ?? '')),
  hasToken: Boolean(e.CLAUDE_CODE_OAUTH_TOKEN),
  credFiles: readdirSync(cfg).filter((f) => /credential/i.test(f)),
  ghConfig: e.GH_CONFIG_DIR, ghToken: e.GH_TOKEN ?? null,
  refs: sh('git', ['for-each-ref']).out.trim(),
  remotes: sh('git', ['remote']).out.trim(),
  fixVisible: sh('git', ['cat-file', '-e', e.AB_FAKE_FIX]).rc === 0,
  logAll: sh('git', ['log', '--all', '--format=%s']).out,
  push: sh('git', ['push', 'https://ab-barrier.invalid/x.git', 'HEAD:refs/heads/x']),
  sshPush: sh('git', ['push', 'ssh://git@ab-barrier.invalid/x.git', 'HEAD:refs/heads/x']),
  // What the repo's own tests do: clone a local bare repo.
  localClone: (sh('git', ['init', '--quiet', '--bare', join(e.TEMP, 'o.git')]), sh('git', ['clone', '--quiet', join(e.TEMP, 'o.git'), join(e.TEMP, 'c')])),
  credHelpers: sh('git', ['config', '--get-regexp', '^credential']).out.trim(),
  ancestors,
  harnessCheckout: existsSync(join(e.HOME, 'code', 'claude-config')),
  skills: existsSync(join(cfg, 'skills')) ? readdirSync(join(cfg, 'skills')) : [],
  agents: existsSync(join(cfg, 'agents')) ? readdirSync(join(cfg, 'agents')) : [],
  settings: JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8')),
  claudeJson: JSON.parse(readFileSync(join(cfg, '.claude.json'), 'utf8')),
  projects: existsSync(join(cfg, 'projects')) ? readdirSync(join(cfg, 'projects')) : [],
}));
writeFileSync('a.txt', 'changed\\n');
writeFileSync('new.txt', 'new\\n');
writeFileSync('COMMIT_MSG_9.txt', 'What: x\\n');
writeFileSync('leak.txt', 'read ' + e.AB_FAKE_LEAK + '\\n');
mkdirSync(join(cfg, 'projects', 'k'), { recursive: true });
// Claude Code's transcript shapes: a tool call (what the session ran) and the result it was served.
const call = (name, input) => ({ type: 'assistant', cwd, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name, input }] } });
const served = (content) => ({ type: 'user', cwd, message: { role: 'user', content: [{ tool_use_id: 't', type: 'tool_result', content }] } });
const readme = readFileSync('hooks/README.md', 'utf8');
// Git Bash shows the round under /tmp, the real temp's mount.
const roundAlias = '/tmp' + e.HOME.slice(e.AB_FAKE_REAL_TEMP.length).replace(/\\\\/g, '/');
// A Read of a repo file that names the live hooks (explained), a cat of that same live path, reaches
// into the real workspace, config and temp (flagged), the round's own /tmp alias (masked), Claude
// Code's environment note naming bare /tmp (explained), and an echo of the token (redacted).
const lines = [
  call('Read', { file_path: 'hooks/README.md' }), served(readme),
  call('Bash', { command: 'cat ' + JSON.parse(readme).args[0] }),
  call('Bash', { command: 'type ' + e.AB_FAKE_LEAK }),
  call('Bash', { command: 'type ' + e.AB_FAKE_CONFIG_LEAK }),
  call('Bash', { command: 'type ' + e.AB_FAKE_TEMP_LEAK + ' (tmp is ' + e.TEMP + ')' }),
  call('Bash', { command: 'ls /tmp/claude/other-session' }),
  call('Bash', { command: 'pwd' }), served(roundAlias + '/code/.worktrees/claude-config-1'),
  { type: 'attachment', attachment: { type: 'environment', content: 'use it instead of \`/tmp\`' } },
  { echoed: e.CLAUDE_CODE_OAUTH_TOKEN },
];
writeFileSync(join(cfg, 'projects', 'k', 's.jsonl'), lines.map((l) => JSON.stringify(l)).join('\\n') + '\\n');
process.stderr.write('env: ' + e.CLAUDE_CODE_OAUTH_TOKEN + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5, num_turns: 2, total_cost_usd: 0.25, session_id: 's', result: 'done ' + e.CLAUDE_CODE_OAUTH_TOKEN }));
// A session that wrecks its checkout: the runner's capture throws right after claude.stderr.log.
if (e.AB_FAKE_WRECK) { rmSync('.git', { recursive: true, force: true }); writeFileSync('.git', 'gitdir: missing\\n'); }
`;

const code = join(home, 'code');
const realTemp = join(home, 't');
/** The temp and results dirs of the rounds whose capture throws (Major C). */
const wreck = { temp: join(home, 'tw'), out: join(home, 'out-wreck') };
const fx = {};
const TOKEN = `sk-ant-oat01-AB-FAKE-${randomBytes(6).toString('hex')}`;
const LEAKS = {
  workspace: join(code, 'claude-config', 'x'),
  config: join(home, '.claude', 'projects', 'C--real', 't.jsonl'),
  temp: join(realTemp, 'claude', 'other-session', 'notes.md'),
};
/** The live hook path hooks/README.md spells, as the real one does. */
const README_PATH = `${code.replace(/\\/g, '/')}/claude-config/hooks/bash-guard.mjs`;
/** Every file under `dir`, recursively. */
const filesUnder = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map((f) => join(dir, String(f))).filter((f) => statSync(f).isFile()) : []);

before(() => {
  // The harness repo: the ticket's parent (which is also the harness the current arm runs), then the fix on main.
  const cc = join(code, 'claude-config');
  const files = {
    'a.txt': 'base\n',
    'hooks/README.md': `{ "args": ["${README_PATH}"] }\n`,
    'hooks/session-start.mjs': 'process.exit(0);\n',
    'workspace/CLAUDE.md': '# ROOT-MARK\n',
    'workspace/web/CLAUDE.md': '# WEB-MARK\n',
    'workspace/.claude/rules/r.md': 'rule\n',
    'skills/qa/SKILL.md': '---\nname: qa\n---\n',
    'agents/implementer.md': 'agent\n',
    // The gate reports the env model-written code runs under, and reads the real workspace when told to.
    'gate.mjs': [
      "console.log('tests 1');",
      'const e = process.env;',
      "console.log('GATE-ENV ' + JSON.stringify({ home: e.HOME, userprofile: e.USERPROFILE, homeDrivePath: (e.HOMEDRIVE ?? '') + (e.HOMEPATH ?? ''), appData: e.APPDATA, localAppData: e.LOCALAPPDATA, temp: e.TEMP, tmp: e.TMP, tmpdir: e.TMPDIR, hasToken: Boolean(e.CLAUDE_CODE_OAUTH_TOKEN) }));",
      "if (e.AB_FAKE_LEAK) console.log('read ' + e.AB_FAKE_LEAK);",
      '',
    ].join('\n'),
  };
  for (const [f, text] of Object.entries(files)) put(join(cc, f), text);
  git(cc, 'init', '--quiet', '-b', 'main');
  git(cc, 'add', '-A');
  git(cc, 'commit', '--quiet', '-m', 'base');
  fx.parent = git(cc, 'rev-parse', 'HEAD');
  put(join(cc, 'a.txt'), 'SECRET-FIX\n');
  git(cc, 'commit', '--quiet', '-am', 'fix: the answer (#1)');
  fx.merge = git(cc, 'rev-parse', 'HEAD');
  // The user's real config, as the runner finds it.
  const live = cc.replace(/\\/g, '/');
  put(join(home, '.claude', 'settings.json'), JSON.stringify({
    model: 'opus',
    statusLine: { type: 'command', command: `node ${live}/statusline/statusline.mjs` },
    enabledPlugins: { p: true },
    hooks: {
      PermissionRequest: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:9/hooks' }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: [`${live}/hooks/session-start.mjs`] }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'node', args: [`${live}/hooks/gone.mjs`] }] }],
    },
  }));
  put(join(home, '.claude', '.credentials.json'), '{"token":"t"}');
  put(join(home, '.claude', '.claude.json'), JSON.stringify({ oauthAccount: { a: 1 }, projects: { x: {} } }));
  put(join(home, '.claude', 'projects', 'C--real', 'memory', 'MEMORY.md'), 'REAL-MEMORY\n');
  put(join(home, 'm', 'manifest.json'), JSON.stringify({
    issue: 'o/r#1', owner: 'o', model: 'claude-opus-5-5', effort: 'high', permissionMode: 'auto', runsPerArm: 1,
    prior: { usdPerRun: 1, turnsPerRun: 5, source: 's' },
    tickets: [{
      id: 'claude-config-1', path: 'claude-config', issue: 1, kind: 'bug', title: 't', pr: 2, merge: fx.merge, parent: fx.parent, harness: fx.parent, lines: 10, why: 'w',
      gates: [{ name: 'test', cmd: 'node gate.mjs', requireMatch: 'tests [1-9]' }, { name: 'shrunk', cmd: 'node gate.mjs', requireMatch: 'tests [2-9]' }],
    }],
  }));
  put(join(home, 'm', 'tickets', 'claude-config-1.md'), '## Done when\n- [ ] it works\n');
  put(join(home, 'fake-claude.mjs'), FAKE);
  // current keeps its round (--keep); bare takes the default, which removes it after capture.
  const runArm = (arm, { temp, out, wrecks }) => {
    const report = join(home, `report-${arm}${wrecks ? '-wreck' : ''}.json`);
    const r = spawnHarness(RUN, ['--manifest', join(home, 'm', 'manifest.json'), '--only', 'claude-config-1', '--arm', arm, '--run', '1', '--out', out, ...(arm === 'current' ? ['--keep'] : [])], {
      home,
      env: {
        TEMP: temp, TMP: temp, TMPDIR: temp,
        AB_CLAUDE_BIN: join(home, 'fake-claude.mjs'), AB_FAKE_REPORT: report, AB_FAKE_FIX: fx.merge, AB_FAKE_REAL_TEMP: temp,
        AB_FAKE_LEAK: LEAKS.workspace, AB_FAKE_CONFIG_LEAK: LEAKS.config, AB_FAKE_TEMP_LEAK: LEAKS.temp,
        CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
        ...(wrecks && { AB_FAKE_WRECK: '1' }),
      },
    });
    const dir = join(out, 'runs', 'claude-config-1', `${arm}-r1`);
    return { r, report: existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null, dir, result: existsSync(join(dir, 'result.json')) ? JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')) : null };
  };
  for (const arm of ['current', 'bare']) fx[arm] = runArm(arm, { temp: realTemp, out: join(home, 'out') });
  fx.wreck = {};
  for (const arm of ['current', 'bare']) fx.wreck[arm] = runArm(arm, { temp: wreck.temp, out: wreck.out, wrecks: true });
});

test('a live round runs to a result in both arms', () => {
  for (const arm of ['current', 'bare']) {
    assert.equal(fx[arm].r.status, 0, `${arm}: ${fx[arm].r.stderr}`);
    const res = fx[arm].result;
    assert.equal(res.arm, arm);
    assert.equal(res.claude.costUsd, 0.25);
    assert.equal(res.claude.turns, 2);
    assert.equal(res.harness, arm === 'current' ? fx.parent : null);
    assert.equal(res.interventions, undefined, 'never measured, so not recorded');
  }
});

test('C1: the checkout holds the parent only, with no branch, remote or object that leads to the fix', () => {
  for (const arm of ['current', 'bare']) {
    const rep = fx[arm].report;
    assert.equal(rep.fixVisible, false, arm);
    assert.doesNotMatch(rep.logAll, /the answer/, arm);
    assert.equal(rep.refs, '', arm);
    assert.equal(rep.remotes, '', arm);
    assert.doesNotMatch(readFileSync(join(fx[arm].dir, 'diff.patch'), 'utf8'), /SECRET-FIX/, arm);
  }
});

test('M2: the current arm runs the harness at its commit: ancestor CLAUDE.md, skills, agents and rewritten hooks; bare gets none', () => {
  const cur = fx.current.report;
  const bare = fx.bare.report;
  const root = fx.current.result.roundRoot;
  assert.deepEqual(cur.ancestors, [join(root, 'code', 'CLAUDE.md')]);
  assert.match(readFileSync(cur.ancestors[0], 'utf8'), /^# ROOT-MARK\r?\n$/);
  assert.deepEqual(cur.skills, ['qa']);
  assert.deepEqual(cur.agents, ['implementer.md']);
  const hookArgs = cur.settings.hooks.SessionStart[0].hooks[0].args[0];
  assert.equal(hookArgs, `${join(root, 'code', 'claude-config').replace(/\\/g, '/')}/hooks/session-start.mjs`);
  assert.deepEqual(Object.keys(cur.settings.hooks), ['SessionStart'], 'the missing and the http hook are dropped');
  assert.equal(cur.settings.statusLine, undefined);
  assert.equal(cur.home, root);
  assert.equal(cur.userprofile, root);
  assert.equal(cur.cfg, join(root, '.claude'));
  assert.deepEqual(cur.claudeJson, { oauthAccount: { a: 1 } });
  assert.ok(!cur.argv.includes('--safe-mode'));
  assert.equal(cur.harnessCheckout, true);
  assert.deepEqual(bare.ancestors, []);
  assert.deepEqual(bare.skills, []);
  assert.deepEqual(bare.agents, []);
  assert.equal(bare.settings.hooks, undefined);
  assert.equal(bare.argv[0], '--safe-mode');
  assert.equal(bare.harnessCheckout, false, 'no harness checkout in the bare round');
});

test('M2: both arms get the same prompt, the issue body alone', () => {
  assert.equal(fx.current.report.prompt, fx.bare.report.prompt);
  assert.equal(fx.current.report.prompt, '## Done when\n- [ ] it works\n');
});

test('M3: neither arm starts with any auto-memory or transcript', () => {
  for (const arm of ['current', 'bare']) assert.deepEqual(fx[arm].report.projects, [], arm);
});

test('Major A: the session alone gets CLAUDE_CODE_OAUTH_TOKEN; no login is copied and the value is written nowhere, result.json included', () => {
  for (const arm of ['current', 'bare']) {
    const { r, report, result, dir } = fx[arm];
    assert.equal(report.hasToken, true, arm);
    assert.deepEqual(report.credFiles, [], `${arm}: no credentials file in the round config`);
    for (const g of ['test', 'shrunk']) assert.match(readFileSync(join(dir, `gate-${g}.log`), 'utf8'), /"hasToken":false/, `${arm}: gate ${g} runs without it`);
    // The fake echoed the exact value to stderr, its transcript and its final message; each copy is redacted.
    assert.match(readFileSync(join(dir, 'claude.stderr.log'), 'utf8'), new RegExp(`env: ${TOKEN_PLACEHOLDER.replace(/[<>]/g, '\\$&')}`));
    assert.equal(result.claude.result, `done ${TOKEN_PLACEHOLDER}`, `${arm}: the final message in result.json`);
    const kept = arm === 'current' ? filesUnder(join(result.roundRoot, '.claude')) : [];
    for (const f of [...filesUnder(dir), ...kept]) assert.ok(!readFileSync(f, 'latin1').includes(TOKEN), `${arm}: token in ${f}`);
    assert.ok(!`${r.stdout}${r.stderr}`.includes(TOKEN), `${arm}: token in the runner output`);
    // claude.json, claude.stderr.log, the transcript copy, result.json and the round's own transcript,
    // which is redacted before the round is removed too, in case the removal fails.
    assert.equal(result.tokenRedactions, 5, arm);
  }
});

test('Major B and 3: the session and the gates find the round as home and as temp through every variable', () => {
  for (const arm of ['current', 'bare']) {
    const { report, result, dir } = fx[arm];
    const root = result.roundRoot;
    const tmp = join(root, 'tmp');
    const want = { home: root, userprofile: root, homeDrivePath: root, appData: join(root, 'AppData', 'Roaming'), localAppData: join(root, 'AppData', 'Local'), temp: tmp, tmp, tmpdir: tmp };
    for (const [k, v] of Object.entries(want)) assert.equal(report[k], v, `${arm} session ${k}`);
    assert.equal(report.dirsExist, true, arm);
    const gateEnv = JSON.parse(/^GATE-ENV (.*)$/m.exec(readFileSync(join(dir, 'gate-test.log'), 'utf8'))[1]);
    for (const [k, v] of Object.entries(want)) assert.equal(gateEnv[k], v, `${arm} gate ${k}`);
  }
});

test('Major 3: the round dir is removed after capture unless --keep, and a kept round names a PowerShell removal', () => {
  assert.equal(existsSync(fx.bare.result.roundRoot), false, 'bare: removed');
  assert.match(fx.bare.r.stdout, /removed the round dir/);
  assert.equal(existsSync(fx.current.result.roundRoot), true, 'current: --keep');
  assert.ok(fx.current.r.stdout.includes(`Remove-Item -Recurse -Force "${fx.current.result.roundRoot}"`));
  for (const arm of ['current', 'bare']) assert.doesNotMatch(fx[arm].r.stdout, /rm -rf/, arm);
});

test('M4: push is refused before any network and no credential helper or GitHub token reaches the session', () => {
  for (const arm of ['current', 'bare']) {
    const rep = fx[arm].report;
    assert.notEqual(rep.push.rc, 0, arm);
    assert.match(rep.push.out, /transport 'https' not allowed/, arm);
    assert.match(rep.sshPush.out, /transport 'ssh' not allowed/, arm);
    assert.equal(rep.localClone.rc, 0, `${arm}: a local clone works, as the repo's tests need: ${rep.localClone.out}`);
    assert.equal(rep.credHelpers, '', arm);
    assert.equal(rep.ghToken, null, arm);
    assert.equal(rep.ghConfig, join(fx[arm].result.roundRoot, '.config', 'gh'), arm);
  }
});

test('M4: gh cannot comment from the barrier env', { skip: !hasGh && 'gh not installed' }, () => {
  const layout = roundLayout({ id: 'x', path: 'claude-config', issue: 1 }, 'gh-probe', { tmp: join(home, 'g'), workspace: code });
  mkdirSync(layout.gh, { recursive: true });
  const r = spawnSync('gh', ['issue', 'comment', '1', '--repo', 'ab-barrier/none', '--body', 'x'], { encoding: 'utf8', env: childEnv(process.env, barrierEnv(layout)) });
  assert.notEqual(r.status, 0);
  assert.match(`${r.stdout}${r.stderr}`, /gh auth login|GH_TOKEN/);
});

test('M5 / Major 2 / round 6 A+B: a path the round served (a Read of hooks/README.md) is explained; a command that spells it, and every reach into the real workspace, config and temp (/tmp included), flag', () => {
  for (const arm of ['current', 'bare']) {
    const { result, dir } = fx[arm];
    assert.ok(existsSync(join(dir, 'transcripts', 'k', 's.jsonl')), arm);
    assert.deepEqual(
      result.contamination,
      [
        { source: 'tool inputs', label: 'workspace', count: 2, paths: [LEAKS.workspace, README_PATH] },
        { source: 'tool inputs', label: 'config', count: 1, paths: [LEAKS.config] },
        { source: 'tool inputs', label: 'temp', count: 2, paths: [LEAKS.temp, '/tmp/claude/other-session'] },
        ...['diff.patch', 'gate-test.log', 'gate-shrunk.log'].map((source) => ({ source, label: 'workspace', count: 1, paths: [LEAKS.workspace] })),
      ],
      arm,
    );
    assert.deepEqual(
      result.contaminationExplained,
      [
        { source: 'transcripts', label: 'workspace', count: 1, paths: [README_PATH] },
        { source: 'transcripts', label: 'temp', count: 1, paths: ['/tmp'] },
      ],
      arm,
    );
  }
  assert.notEqual(fx.current.result.roundRoot, fx.bare.result.roundRoot);
});

test('Major C (round 6): when capture throws after claude.stderr.log, no token is left on disk, and the round is removed or, under --keep, named for removal', () => {
  for (const arm of ['current', 'bare']) {
    const { r } = fx.wreck[arm];
    assert.notEqual(r.status, 0, arm);
    assert.match(r.stderr, /not a git repository/, `${arm}: the capture failure is reported`);
    assert.ok(existsSync(join(fx.wreck[arm].dir, 'claude.stderr.log')), `${arm}: capture got past claude.stderr.log`);
    assert.ok(!`${r.stdout}${r.stderr}`.includes(TOKEN), `${arm}: token in the runner output`);
  }
  for (const f of [...filesUnder(wreck.out), ...filesUnder(wreck.temp)]) assert.ok(!readFileSync(f, 'latin1').includes(TOKEN), `token in ${f}`);
  assert.match(fx.wreck.bare.r.stdout, /removed the round dir/);
  const left = readdirSync(join(wreck.temp, 'ab'));
  assert.equal(left.length, 1, 'only the --keep round is left');
  assert.ok(fx.wreck.current.r.stdout.includes(`Remove-Item -Recurse -Force "${join(wreck.temp, 'ab', left[0])}"`));
  assert.ok(existsSync(join(wreck.temp, 'ab', left[0], '.claude', 'projects', 'k', 's.jsonl')), 'the kept transcript is there, redacted');
});

test('grade.mjs excludes a contaminated run, holds a packet that still names its arm, packets the rest, and counts both per arm', () => {
  const out = join(home, 'grade-out');
  const runs = join(out, 'runs', 'claude-config-1');
  cpSync(fx.bare.dir, join(runs, 'bare-r1'), { recursive: true });
  const cleanCopy = (name, run) => {
    cpSync(fx.current.dir, join(runs, name), { recursive: true });
    const f = join(runs, name, 'result.json');
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), run, contamination: [] }));
  };
  cleanCopy('current-r1', 1);
  cleanCopy('current-r2', 2);
  // A diff that legitimately adds a commit-template line still can't go to a grader blind; only its packet is held.
  appendFileSync(join(runs, 'current-r2', 'diff.patch'), 'diff --git a/tmpl.md b/tmpl.md\n+**What:** <mechanism>\n');
  const r = spawnHarness(GRADE, ['--out', out, '--manifest', join(home, 'm', 'manifest.json')], { home });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 packet\(s\) in .*; excluded as contaminated: bare 1, current 0; held as still identifying their arm: bare 0, current 1/);
  assert.equal(readdirSync(join(out, 'packets')).length, 1);
  const key = JSON.parse(readFileSync(join(out, 'blind-key.json'), 'utf8'));
  assert.deepEqual(Object.values(key.packets), [{ ticket: 'claude-config-1', arm: 'current', run: 1 }]);
  assert.deepEqual(key.excluded.map((x) => [x.ticket, x.arm, x.run]), [['claude-config-1', 'bare', 1]]);
  assert.match(key.excluded[0].reason, /^contaminated: workspace 2x in tool inputs, /);
  assert.deepEqual(key.held.map((x) => [x.ticket, x.arm, x.run]), [['claude-config-1', 'current', 2]]);
  assert.match(key.held[0].reason, /commit-body vocabulary/);
});

test('the diff holds every change the session left, and gates are judged on output as well as exit code', () => {
  for (const arm of ['current', 'bare']) {
    const { result, dir } = fx[arm];
    const diff = readFileSync(join(dir, 'diff.patch'), 'utf8');
    assert.match(diff, /new\.txt/);
    assert.match(diff, /\+changed/);
    assert.equal(result.baseline.changedFromParent, 0);
    assert.deepEqual(result.gates.map((g) => [g.name, g.exit, g.rc]), [['test', 0, 0], ['shrunk', 0, 1]]);
    assert.match(result.gates[1].reason, /requireMatch/);
    assert.equal(existsSync(join(dir, 'setup.log')), false, 'no setup step: the product tickets that had one are gone');
  }
});
