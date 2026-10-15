// node --test scripts/test/bash-guard-options.test.mjs
// #253: cases generated from bash-guard's option tables (PREFIX, and the
// xargs/parallel tables readOption reads), so a table edit can't open a false
// allow that guard-replay never sees: real history holds no attack-shaped
// commands. Cases run in Bash only: the option readers don't depend on the
// shell, and bash-guard.test.mjs pins each shell's own parsing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gatedVerbs, staticCheck, UnreadableError, PREFIX, XARGS, PARALLEL, OPTION_ROLES, REPLACE_TOKEN } from '../../hooks/bash-guard.mjs';

const RM = 'rm -rf ~/.claude';
const PUSH = 'git push';
const GATE_FILE = '~/.claude/push-gate-approvals.json';
const RUNNERS = [['xargs', XARGS], ['parallel', PARALLEL]];
const TABLES = [...PREFIX, ...RUNNERS];

const verdicts = new Map();
/** Does the guard stop `c`: rule 11 blocks it, the push gate gates it, or it
 *  is blocked unread? Memoized, as the ambiguous checks ask again. */
function stops(c) {
  if (!verdicts.has(c)) {
    let v;
    try {
      v = /#190/.test(staticCheck(c, '/work', 'Bash') ?? '') || gatedVerbs(c, '/work', 'Bash').includes(PUSH);
    } catch (e) {
      if (!(e instanceof UnreadableError)) throw e;
      v = true;
    }
    verdicts.set(c, v);
  }
  return verdicts.get(c);
}

// --- the tables, as their header documents them ------------------------------

const roles = (spec, name) => new Set(OPTION_ROLES.filter((r) => spec[r]?.test(name)));
const longs = (spec) => (spec.long ?? '').split(' ').filter(Boolean).map((o) => ({ name: o.replace(/[=!]$/, ''), long: true, takes: o.endsWith('='), stops: o.endsWith('!') }));
const longNames = (spec) => longs(spec).map((o) => o.name);
/** A table's short options: the ones it lists, and the ones a role names (sudo -e, watch -x). */
const shorts = (spec) =>
  [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789']
    .filter((l) => [spec.value, spec.stop, spec.optional, spec.either].some((s) => s?.includes(l)) || roles(spec, l).size)
    .map((l) => ({ name: l, takes: !!spec.value?.includes(l), stops: !!spec.stop?.includes(l), optional: !!spec.optional?.includes(l), either: !!spec.either?.includes(l) }));

/** The shortest abbreviation of long option `name` that names it alone: an
 *  exact name wins (`--login` is not an abbreviation of --login-class). */
function shortest(names, name) {
  for (let n = 1; n < name.length; n++) {
    const p = name.slice(0, n);
    if (!names.includes(p) && names.filter((x) => x.startsWith(p)).length === 1) return p;
  }
  return name;
}

/** Every prefix that abbreviates several long options and names none exactly, with the options. */
function ambiguous(names) {
  const out = new Map();
  for (const name of names) {
    for (let n = 1; n < name.length; n++) {
      const p = name.slice(0, n);
      const all = names.filter((x) => x.startsWith(p));
      if (!names.includes(p) && all.length > 1) out.set(p, all);
    }
  }
  return out;
}

/** The words each prefix runs before its command (timeout's duration, flock's lock file). */
const ARGS = { timeout: '5', taskset: '0x3', chrt: '10', flock: '/tmp/l' };

/** `tool` given options `opts` and then the call `body`: past su's user (its
 *  shell gets the words after `--`), as script's -c line, or after a prefix's
 *  leading words. */
function place(tool, spec, opts, body) {
  if (spec.operands === 'none') return `${tool} ${opts} root -- -c '${body}'`;
  if (spec.operands === 'files' && spec.shell) return `${tool} ${opts} -c '${body}'`;
  return [tool, opts, ARGS[tool], body].filter(Boolean).join(' ');
}

/** `tool` given options `opts` whose value is the shell line it runs (su -c, env -S). */
const lineCall = (tool, spec, opts) => [tool, opts, spec.operands === 'none' ? 'root' : ARGS[tool]].filter(Boolean).join(' ');

/** What a table's options run, as [body, stops?] pairs: the call after them,
 *  or with `files` the operands written and nothing run (sudoedit, sudo -e). */
const bodies = (files) => (files ? [[GATE_FILE, true], [PUSH, false]] : [[RM, true], [PUSH, true]]);

/** The ways to write option `o`, exactly and as its shortest abbreviation:
 *  with value `v` attached and as the next word; with none, bare, and for a
 *  long that runs on also with a value attached, which it may take as an
 *  optional one (`--replace=X`, `--eof=X`). */
function spellings(spec, o, v) {
  if (!o.long) return v === undefined ? [`-${o.name}`] : [`-${o.name}${v}`, `-${o.name} ${v}`];
  const names = [...new Set([o.name, shortest(longNames(spec), o.name)])];
  if (v !== undefined) return names.flatMap((n) => [`--${n}=${v}`, `--${n} ${v}`]);
  return names.flatMap((n) => (o.stops ? [`--${n}`] : [`--${n}`, `--${n}=5`]));
}

/** Cases for option `o` of `tool`'s table, as [command, stops?]: each
 *  spelling before the call. A stop runs nothing; a no-value option leaves
 *  the next word as the command (`sudo --login x git push` runs x). */
function optionCases(tool, spec, o) {
  const r = roles(spec, o.name);
  const spell = (v) => spellings(spec, o, v);
  const files = (spec.operands === 'files' && !spec.shell) || r.has('edit');
  const out = [];
  const each = (sps, at = (sp, b) => place(tool, spec, sp, b)) => {
    for (const sp of sps) for (const [b, want] of bodies(files)) out.push([at(sp, b), want && !o.stops]);
  };
  if (o.stops) each(spell());
  else if (o.either) each([`-${o.name}`, `-${o.name} 5`]);
  else if (r.has('edit')) each(spell(), (sp, b) => `${tool} ${sp} ${b}`);
  else if (r.has('command')) each(spell(o.takes ? '5' : undefined), (sp, b) => `${tool} ${sp} ${b}`);
  else if (r.has('shell') || r.has('split')) {
    for (const [b] of bodies(false)) for (const sp of spell(`'${b}'`)) out.push([lineCall(tool, spec, sp), true]);
  } else if (r.has('program')) each(spell('/bin/sh'));
  else if (o.optional) each([`-${o.name}`, `-${o.name}5`]);
  else if (o.takes) each(spell('5'));
  else each(spell());
  if (r.has('writes')) {
    for (const sp of spell(GATE_FILE)) out.push([place(tool, spec, sp, 'true'), true]);
    if (spec.pipes) for (const [b] of bodies(false)) for (const sp of spell(`'|${b}'`)) out.push([place(tool, spec, sp, 'true'), true]);
  }
  // A no-value option takes no word: one put after it is the command. Not
  // where the operands are files (it is one more), nor su's (it goes to the
  // user's shell, read as `sh root -c …`).
  const takesNoWord = !o.stops && !o.takes && !o.optional && !o.either;
  const commandFollows = !files && !['none', 'files'].includes(spec.operands);
  if (takesNoWord && commandFollows) for (const sp of spell()) out.push([place(tool, spec, `${sp} x`, PUSH), false]);
  return out;
}

/** A runner's (xargs, parallel) replace-token options (xargs -I X, -iX, --replace=X): the
 *  token in the payload is each word the pipeline feeds it, and the token's
 *  value is no command. */
function tokenCases(tool, spec) {
  const out = [];
  if (!RUNNERS.some(([, r]) => r === spec)) return out;
  for (const o of [...shorts(spec), ...longs(spec)].filter((x) => REPLACE_TOKEN.test(x.name))) {
    const sps = o.takes ? spellings(spec, o, 'X') : o.long ? spellings(spec, o).filter((sp) => sp.includes('=')).map((sp) => sp.replace(/=5$/, '=X')) : [`-${o.name}X`];
    for (const sp of sps) out.push([`echo ~/.claude | ${tool} ${sp} rm -rf X`, true], [`${tool} ${sp} ${PUSH}`, true]);
  }
  return out;
}

/** Every case for `tool`'s table: the bare prefix, then each option. */
function tableCases(tool, spec) {
  const files = spec.operands === 'files' && !spec.shell;
  const bare = bodies(files).map(([b, want]) => [place(tool, spec, '', b), want]);
  return [...bare, ...[...shorts(spec), ...longs(spec)].flatMap((o) => optionCases(tool, spec, o)), ...tokenCases(tool, spec)];
}

const misread = (cases) => cases.filter(([c, want]) => stops(c) !== want).map(([c, want]) => `${want ? 'should stop' : 'should run nothing'}: ${c}`);

for (const [tool, spec] of TABLES) {
  test(`#253: every option in ${tool}'s table, spelled every way, is read as the table says`, () => {
    assert.deepEqual(misread(tableCases(tool, spec)), []);
  });
}

// --- ambiguous abbreviations fail safe (#249) --------------------------------

/** The ways an abbreviation `n` is written before `body` in `tool`'s table. */
function shapes(tool, spec) {
  const out = [(n, b) => place(tool, spec, `--${n}`, b), (n, b) => place(tool, spec, `--${n}=5`, b), (n, b) => place(tool, spec, `--${n} 5`, b)];
  if (spec.shell || spec.split) out.push((n, b) => lineCall(tool, spec, `--${n} '${b}'`), (n, b) => lineCall(tool, spec, `--${n}='${b}'`));
  if (spec.program) out.push((n, b) => place(tool, spec, `--${n} /bin/sh`, b));
  if (spec.writes) out.push((n) => place(tool, spec, `--${n} ${GATE_FILE}`, 'true'));
  return out;
}

/** Every ambiguous check for `tool`'s table, as [prefix, its options, shape, body]. */
const ambiguousChecks = (tool, spec) =>
  [...ambiguous(longNames(spec))].flatMap(([p, all]) => shapes(tool, spec).flatMap((shape) => bodies(spec.operands === 'files' && !spec.shell).map(([b]) => [p, all, shape, b])));

for (const [tool, spec] of TABLES) {
  const checks = ambiguousChecks(tool, spec);
  if (!checks.length) continue;
  test(`#253: an ambiguous abbreviation in ${tool}'s table reads as strictly as its strictest option`, () => {
    const failed = [];
    for (const [p, all, shape, b] of checks) {
      const strictest = all.find((n) => stops(shape(n, b)));
      if (strictest && !stops(shape(p, b))) failed.push(`${shape(p, b)} runs nothing, but as --${strictest} it stops`);
    }
    assert.deepEqual(failed, []);
  });
}

test('#253: the tables generate every case', (t) => {
  const options = TABLES.reduce((n, [tool, spec]) => n + tableCases(tool, spec).length, 0);
  const checks = TABLES.reduce((n, [tool, spec]) => n + ambiguousChecks(tool, spec).length, 0);
  t.diagnostic(`${options} option cases, ${checks} ambiguous checks`);
  // 4275 and 1986 when written: a generator that drops a table or a spelling falls well below.
  assert.ok(options > 4000, `${options} option cases`);
  assert.ok(checks > 1800, `${checks} ambiguous checks`);
});

// --- each installed tool's --help against its table --------------------------

/** Git Bash's usr/bin (git's exec path is <root>/<arch>/libexec/git-core), or null off Windows. */
function gitBashBin() {
  if (process.platform !== 'win32') return null;
  try {
    const bin = join(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), '..', '..', '..', 'usr', 'bin');
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}
const BIN = gitBashBin();

/** Where a table rightly differs from a tool's --help, with the evidence. */
const HELP_DIFFERS = {
  xargs: { 'max-lines': 'its --help shows =MAX-LINES, but findutils reads it as optional: `xargs --max-lines echo hi < /dev/null` prints hi' },
  strace: { pid: 'a stop though it takes a value: MSYS strace runs no command with -p (`strace -p 999999 echo x`: "cannot provide both a command line and a process id")' },
};

for (const [tool, spec] of TABLES) {
  test(`#253: ${tool}'s table lists every long option its --help names, taking a value as it does`, (t) => {
    const exe = BIN && join(BIN, `${tool}.exe`);
    if (!exe || !existsSync(exe)) return t.skip(BIN ? `${tool} is not installed in Git Bash` : 'no Git Bash here (Windows only)');
    const r = spawnSync(exe, ['--help'], { encoding: 'utf8', timeout: 10_000 });
    assert.ifError(r.error);
    assert.equal(r.status, 0, `${tool} --help exited ${r.status}`);
    const listed = new Map(longs(spec).map((o) => [o.name, o]));
    const named = [];
    const wrong = [];
    // Each option line's option column (`  -n, --adjustment=N   add …`), not its prose.
    for (const line of `${r.stdout}${r.stderr}`.split('\n').filter((l) => /^\s+-/.test(l))) {
      for (const [, name, eq] of line.trim().split(/\s{2,}/)[0].matchAll(/--([a-z][\w-]*)(\[?=)?/g)) {
        named.push(name);
        const o = listed.get(name);
        const required = eq === '=';
        if (!o) wrong.push(`--${name} is not listed`);
        else if (HELP_DIFFERS[tool]?.[name]) continue;
        // A stop must take no value: a value option marked `!` hides the command after its value.
        else if (o.stops ? required : o.takes !== required) wrong.push(`--${name} ${required ? 'takes' : 'takes no'} value, listed as \`${name}${o.stops ? '!' : o.takes ? '=' : ''}\``);
      }
    }
    assert.ok(named.length, `no option parsed from ${tool} --help`);
    assert.deepEqual(wrong, []);
  });
}
