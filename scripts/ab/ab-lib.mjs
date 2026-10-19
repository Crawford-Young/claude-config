// Shared parts of the #271 A/B runner, side-effect free: the ticket manifest, a round's layout and
// env, each arm's settings, the claude command, the prompt and its Done-when boxes, gate verdicts,
// the per-round estimate and the plan that run.mjs prints (dry run) or executes (round.mjs).

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export const ARMS = ['bare', 'current'];
/** Where runs, packets and canary captures go, beside qa.mjs's logs. */
export const DEFAULT_OUT = join(homedir(), '.claude', 'ab-271');
/** The harness repo under the workspace. */
export const HARNESS_PATH = 'claude-config';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// bypassPermissions is left out on purpose: the bare arm runs with no hooks to stop a stray command.
const PERMISSION_MODES = ['auto', 'acceptEdits', 'dontAsk'];
const SHA_RE = /^[0-9a-f]{40}$/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isRegex = (s) => {
  try {
    new RegExp(s, 'm');
    return true;
  } catch {
    return false;
  }
};

/** The validated manifest from its JSON text. Throws one Error naming every problem. */
export function parseManifest(text) {
  let m;
  try {
    m = JSON.parse(text);
  } catch (e) {
    throw new Error(`manifest is not JSON: ${e.message}`);
  }
  const problems = [];
  const need = (ok, msg) => ok || problems.push(msg);
  need(typeof m.model === 'string' && m.model, 'model must be a model id');
  need(EFFORTS.includes(m.effort), `effort must be one of ${EFFORTS.join(', ')}`);
  need(PERMISSION_MODES.includes(m.permissionMode), `permissionMode must be one of ${PERMISSION_MODES.join(', ')}`);
  need(Number.isInteger(m.runsPerArm) && m.runsPerArm >= 1, 'runsPerArm must be a whole number >= 1');
  need(m.prior?.usdPerRun > 0 && m.prior?.turnsPerRun > 0, 'prior needs usdPerRun and turnsPerRun > 0');
  need(Array.isArray(m.tickets) && m.tickets.length > 0, 'tickets must be a non-empty list');
  const seen = new Set();
  for (const t of m.tickets || []) {
    const id = t.id;
    if (!ID_RE.test(id ?? '')) {
      problems.push(`ticket id must be a kebab slug, got ${JSON.stringify(id)}`);
      continue;
    }
    if (seen.has(id)) problems.push(`duplicate ticket id ${id}`);
    seen.add(id);
    // Round 5 (user, 2026-10-16): the A/B is harness only; a product repo would need the setup and LFS handling the runner dropped.
    need(t.path === HARNESS_PATH, `${id}: path must be ${HARNESS_PATH} (the A/B is harness only)`);
    need(Number.isInteger(t.issue) && t.issue > 0, `${id}: issue must be an issue number`);
    for (const k of ['parent', 'merge', 'harness']) need(SHA_RE.test(t[k] ?? ''), `${id}: ${k} must be a 40-char SHA`);
    need(Number.isInteger(t.lines) && t.lines > 0, `${id}: lines must be a whole number > 0`);
    need(
      Array.isArray(t.gates) && t.gates.length > 0 && t.gates.every((g) => g?.name && g?.cmd),
      `${id}: gates must list at least one {name, cmd}`,
    );
    for (const g of t.gates ?? []) {
      for (const k of ['failIf', 'requireMatch']) if (g?.[k] !== undefined) need(isRegex(g[k]), `${id}: gate ${g.name} ${k} is not a regex`);
    }
  }
  if (problems.length) throw new Error(`manifest invalid:\n  ${problems.join('\n  ')}`);
  return m;
}

/** The manifest at `file`, each ticket carrying `body`, the text of tickets/<id>.md beside it. */
export function loadManifest(file) {
  const m = parseManifest(readFileSync(file, 'utf8'));
  for (const t of m.tickets) t.body = readFileSync(join(dirname(file), 'tickets', `${t.id}.md`), 'utf8');
  return m;
}

const lf = (s) => s.replace(/\r\n/g, '\n');

/** The prompt both arms get: the issue body, LF endings, every Done-when box unchecked. */
export const promptFrom = (body) => `${lf(body).replace(/^(\s*[-*] )\[[xX]\]/gm, '$1[ ]').trimEnd()}\n`;

/** The Done-when boxes of an issue body (wrapped lines joined), or its inline `**Done when:**` line. */
export function doneWhen(body) {
  const lines = lf(body).split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s*Done when\b/i.test(l));
  if (start >= 0) {
    const boxes = [];
    for (const l of lines.slice(start + 1)) {
      if (/^#{1,6}\s/.test(l)) break;
      const box = /^\s*[-*] \[[ xX]\]\s*(.*)$/.exec(l);
      if (box) boxes.push(box[1].trim());
      else if (boxes.length && /^\s+\S/.test(l)) boxes[boxes.length - 1] += ` ${l.trim()}`;
    }
    if (boxes.length) return boxes;
  }
  const inline = /\*\*Done when:\*\*\s*(.+)/i.exec(body);
  return inline ? [inline[1].trim()] : [];
}

const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const isInside = (child, parent) => norm(child) === norm(parent) || norm(child).startsWith(`${norm(parent)}/`);

/** A round's directories. The same for both arms and free of the arm's name: <root> is the session's
 *  home, <root>/code a stand-in workspace, the checkout sits where worktree.mjs puts a worktree. */
export function roundLayout(ticket, roundId, { tmp, workspace }) {
  const root = join(tmp, 'ab', roundId);
  if (isInside(root, workspace)) throw new Error(`round root ${root} is inside the workspace ${workspace}; its CLAUDE.md would load`);
  const code = join(root, 'code');
  return {
    root,
    code,
    checkout: join(code, '.worktrees', `${basename(ticket.path)}-${ticket.issue}`),
    harness: join(code, HARNESS_PATH),
    config: join(root, '.claude'),
    gh: join(root, '.config', 'gh'),
    gitconfig: join(root, '.gitconfig'),
    appData: join(root, 'AppData', 'Roaming'),
    localAppData: join(root, 'AppData', 'Local'),
    tmp: join(root, 'tmp'),
  };
}

/** CLAUDE.md files Claude Code would load from the directories above `dir` (the checkout's own are the repo's). */
export function ancestorClaudeMds(dir) {
  const found = [];
  let d = dirname(resolve(dir));
  for (;;) {
    for (const f of ['CLAUDE.md', 'CLAUDE.local.md', join('.claude', 'CLAUDE.md')]) {
      if (existsSync(join(d, f))) found.push(join(d, f));
    }
    const up = dirname(d);
    if (up === d) return found;
    d = up;
  }
}

/** The transcript folder name Claude Code derives from a cwd. */
export const projectKey = (p) => p.replace(/[^A-Za-z0-9]/g, '-');

/** Env for a round's session and gates: home, temp, Claude config, gh and git all inside the round,
 *  so nothing reaches the user's state, credentials or other sessions' scratch dirs. Windows code
 *  finds a home through HOMEDRIVE+HOMEPATH and the AppData pair too, so those point at the round as
 *  well; the known-folder API ignores env and still answers the real profile. */
export function barrierEnv(layout) {
  const drive = /^[A-Za-z]:/.exec(layout.root)?.[0] ?? '';
  return {
    HOME: layout.root,
    USERPROFILE: layout.root,
    HOMEDRIVE: drive,
    HOMEPATH: layout.root.slice(drive.length),
    APPDATA: layout.appData,
    LOCALAPPDATA: layout.localAppData,
    TEMP: layout.tmp,
    TMP: layout.tmp,
    TMPDIR: layout.tmp,
    CLAUDE_CONFIG_DIR: layout.config,
    GH_CONFIG_DIR: layout.gh,
    GIT_CONFIG_GLOBAL: layout.gitconfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
  };
}

/** The round's git config from `git config --list -z` output (system then global): every credential
 *  key gone, and no network transport allowed, so neither a push nor a fetch can leave the machine.
 *  The file transport stays: claude-config's own tests clone local repos, and a fetch from the real
 *  workspace has to spell its path, which the contamination scan flags. */
export function gitconfigEntries(listZ) {
  const entries = listZ
    .split('\0')
    .filter(Boolean)
    .map((e) => {
      const i = e.indexOf('\n');
      return i < 0 ? [e, 'true'] : [e.slice(0, i), e.slice(i + 1)];
    })
    .filter(([k]) => !/^credential\./i.test(k));
  return [...entries, ['protocol.allow', 'never'], ['protocol.file.allow', 'always']];
}

const fwd = (p) => p.replace(/\\/g, '/');
/** `//c/Users/...`: Claude Code's absolute-path form for a permission rule. */
const rulePath = (p) => `/${fwd(p).replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`)}`;

/** The arm's settings.json from the user's: live-only wiring dropped (statusline, plugins, the
 *  desktop toast, the HTTP permission hook), deny rules on the real workspace and config. Current
 *  points each hook at the harness checkout and drops hooks that commit doesn't have; bare has none. */
export function transformSettings(settings, { arm, liveHarness, harnessDir, denyRoots, exists }) {
  const s = structuredClone(settings);
  delete s.statusLine;
  delete s.enabledPlugins;
  const deny = denyRoots.flatMap((r) => [`Read(${rulePath(r)}/**)`, `Edit(${rulePath(r)}/**)`]);
  s.permissions = { ...s.permissions, deny: [...(s.permissions?.deny ?? []), ...deny] };
  if (arm === 'bare' || !s.hooks) {
    delete s.hooks;
    return s;
  }
  const live = fwd(liveHarness).toLowerCase();
  const harness = fwd(harnessDir);
  /** `v` with the live harness path (any slash, any case) swapped for the harness checkout. */
  const rewrite = (v) => {
    const i = fwd(v).toLowerCase().indexOf(live);
    return i < 0 ? v : `${fwd(v).slice(0, i)}${harness}${fwd(v).slice(i + live.length)}`;
  };
  // A script path the hook names; a bare word like `node` is not one.
  const scripts = (h) => [h.command, ...(h.args ?? [])].flatMap((a) => (a ?? '').split(' ').filter((w) => w.startsWith(harness)));
  const hooks = {};
  for (const [event, groups] of Object.entries(s.hooks)) {
    if (event === 'Notification') continue;
    const kept = groups
      .map((g) => ({
        ...g,
        hooks: g.hooks
          .filter((h) => h.type === 'command')
          .map((h) => ({ ...h, command: rewrite(h.command), ...(h.args && { args: h.args.map(rewrite) }) }))
          .filter((h) => scripts(h).every(exists)),
      }))
      .filter((g) => g.hooks.length);
    if (kept.length) hooks[event] = kept;
  }
  s.hooks = hooks;
  return s;
}

const DROP_GLOBAL = ['projects', 'githubRepoPaths', 'skillUsage', 'pluginUsage', 'agentLastUsed', 'mcpServers'];
/** The user's global .claude.json without per-project history, usage or MCP servers: the account stays, for auth. */
export function pruneClaudeJson(j) {
  return Object.fromEntries(Object.entries(j).filter(([k]) => !DROP_GLOBAL.includes(k)));
}

/** claude's argv for one round. The arms differ only by --safe-mode. */
export function claudeArgs(arm, { model, effort, permissionMode, budgetUsd }) {
  if (!ARMS.includes(arm)) throw new Error(`arm must be one of ${ARMS.join(', ')}, got ${JSON.stringify(arm)}`);
  const args = ['-p', '--model', model, '--output-format', 'json', '--effort', effort, '--permission-mode', permissionMode, '--permission-prompts', 'none', '--max-budget-usd', String(budgetUsd)];
  return arm === 'bare' ? ['--safe-mode', ...args] : args;
}

/** The claude CLI: AB_CLAUDE_BIN (a .mjs runs under node: the test seam), else the native install, which is not on Git Bash's PATH. */
export function claudeCommand() {
  const bin = process.env.AB_CLAUDE_BIN || join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return /\.m?js$/.test(bin) ? [process.execPath, bin] : [bin];
}

const KEEP = new Set(['CLAUDE_CONFIG_DIR']);
const GITHUB_TOKENS = new Set(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']);

/** The run.mjs and canary.mjs command lines a token instruction names. */
export const RUN_COMMAND = 'run.mjs --only <ticket> --arm <bare|current> --run <n>';
export const CANARY_COMMAND = 'canary.mjs --arm <bare|current>';

/** How a live round authenticates (user decision, 2026-10-16): the user's own long-lived token, set in
 *  their own PowerShell for the one cleared command, so the director never holds it; never a copy of the login. */
export const tokenHow = (command) =>
  `Create one once with \`claude setup-token\`. Then run each cleared round from your own PowerShell with the token set there only: \`$env:CLAUDE_CODE_OAUTH_TOKEN = Read-Host; node scripts/ab/${command}\`. It lasts until that window closes (\`Remove-Item Env:CLAUDE_CODE_OAUTH_TOKEN\` clears it sooner). Set it that way, not as a persistent user env var: every Claude Code session would run on that token. The runner never copies your login (.credentials.json): a refresh inside a copy can revoke the live one`;
export const tokenHelp = (command) => `a live round needs CLAUDE_CODE_OAUTH_TOKEN. ${tokenHow(command)}`;

/** The child env for the gates: `env` without the launching session's CLAUDE* identity (the config
 *  dir stays), the OAuth token, or any GitHub token, plus `extra`. Only claude gets the token. */
export function childEnv(env, extra = {}) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^CLAUDE/i.test(k) && !KEEP.has(k)) continue;
    if (GITHUB_TOKENS.has(k.toUpperCase())) continue;
    out[k] = v;
  }
  return { ...out, ...extra };
}

/** A run's result.json, or null when it is missing or unreadable (a crashed round). */
export function readResult(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The fields the runner keeps from `claude -p --output-format json`; ok:false when stdout isn't that. */
export function parseClaudeJson(text) {
  try {
    const j = JSON.parse(text);
    if (j?.type !== 'result') throw new Error('not a result');
    return { ok: true, subtype: j.subtype ?? null, isError: Boolean(j.is_error), costUsd: j.total_cost_usd ?? null, turns: j.num_turns ?? null, durationMs: j.duration_ms ?? null, sessionId: j.session_id ?? null, result: j.result ?? null };
  } catch {
    return { ok: false, subtype: null, isError: true, costUsd: null, turns: null, durationMs: null, sessionId: null, result: null };
  }
}

/** A gate's rc as CI reads it: a green exit still fails when the output trips failIf or lacks requireMatch. */
export function gateVerdict(gate, exit, out) {
  if (exit !== 0) return { rc: exit, reason: null };
  if (gate.failIf && new RegExp(gate.failIf, 'm').test(out)) return { rc: 1, reason: `output matches failIf /${gate.failIf}/` };
  if (gate.requireMatch && !new RegExp(gate.requireMatch, 'm').test(out)) return { rc: 1, reason: `output lacks requireMatch /${gate.requireMatch}/` };
  return { rc: 0, reason: null };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DELIMS = `\\s\\\\/"'\`<>|*?,;()[\\]{}`;
// A path name character: anything but whitespace, a separator, a quote, a shell/JSON delimiter or
// `:`, which ends a PATH-list entry (a Windows name never holds one past its drive).
const NAME = `[^${DELIMS}:]`;
// Where a root spelling ends: before `:`, or before dots and then a non-name character or the end of
// the text. So code:$PATH, code. and code.\x are the root (Windows drops trailing dots), and code2,
// code.bak and .claude.json are not .claude or code.
const RIGHT = `(?!\\.*[^${DELIMS}.:])`;
// Where a /tmp path can start: the text's start, whitespace, a quote or delimiter, `=` or `:` (an env
// assignment, a PATH list), or a JSON-escaped newline or tab. Not after a name character or a
// separator, so x/tmp/y is no /tmp path.
const ALIAS_START = '(?<=^|[\\s"\'`<>|*?,;()[\\]{}=:&]|\\\\[nrt])';
// What a masked round path reads as: it ends in a name character, so <round>/tmp/x (the round's own
// tmp) can't start a /tmp path.
const ROUND_MASK = '@round@';

/** Git Bash's spelling of `p` under its /tmp mount, which is the real temp `tmp` whatever TEMP the round
 *  sets (msys's usertemp mount): '/tmp' for `tmp` itself, null for a path outside it. Only a Windows
 *  temp (a drive path) has that mount; elsewhere /tmp is a plain path its own spelling covers. */
function tmpAlias(p, tmp) {
  if (!tmp || !/^[A-Za-z]:[\\/]/.test(tmp) || !isInside(p, tmp)) return null;
  return `/tmp${fwd(p).slice(fwd(tmp).replace(/\/+$/, '').length)}`;
}

/** A path in each spelling a transcript or log can carry it, each with its own separator: escaped
 *  twice (a command quoted inside a JSON string inside jsonl: four backslashes), JSON-escaped (two),
 *  raw, forward-slash, git-bash and, under the real temp `tmp`, git-bash's /tmp alias. */
function pathSpellings(p, tmp) {
  const f = fwd(p);
  const bash = f.replace(/^([A-Za-z]):\//, (_, d) => `/${d.toLowerCase()}/`);
  const alias = tmpAlias(p, tmp);
  const all = [
    { text: p.replace(/\\/g, '\\\\\\\\'), sep: '\\\\{4}' },
    { text: p.replace(/\\/g, '\\\\'), sep: '\\\\{2}' },
    { text: p, sep: '\\\\' },
    { text: f, sep: '/' },
    { text: bash, sep: '/' },
    ...(alias ? [{ text: alias, sep: '/', alias: true }] : []),
  ];
  // Keep the last of equal texts: a POSIX path spells the same at every escaping level, and its separator is '/'.
  return all.filter((s, i) => all.findLastIndex((o) => o.text === s.text) === i);
}

const halve = (s) => s.replace(/\\\\/g, '\\');
/** `s` with every escaping level undone: one backslash per separator. */
const unescaped = (s) => (halve(s) === s ? s : unescaped(halve(s)));

/** The real paths the scan looks for: the workspace, the Claude config dir, the global .claude.json and
 *  the .backup copy Claude Code keeps beside it (outside the config dir unless CLAUDE_CONFIG_DIR moves
 *  them in, where the config root covers them) and temp. */
export function scanRoots({ workspace, config, globalJson, temp }) {
  const json = [
    { path: globalJson, label: '.claude.json' },
    { path: `${globalJson}.backup`, label: '.claude.json.backup' },
  ];
  return [{ path: workspace, label: 'workspace' }, { path: config, label: 'config' }, ...(isInside(globalJson, config) ? [] : json), { path: temp, label: 'temp' }];
}

/** How often each source ({name: text}: transcripts, the session's tool inputs and edit content, the
 *  diff's added lines, gate logs) reached each real path ({path, label}) in any spelling: the
 *  after-the-fact check that a session and the code it wrote stayed out of the live workspace, config and
 *  temp (no OS barrier stops Bash on Windows). `mask` paths (the round itself, which sits under the real
 *  temp `tmp`) are blanked first. A hit in a `written` source (what the session wrote: its tool inputs,
 *  its diff) always flags: spelling the path in a command is the reach. A `byLine` source (the content
 *  an Edit, Write or MultiEdit wrote) is read a line at a time: a hit is explained only when its whole
 *  line (a trailing CR dropped) passes `lineExplains` (the checkout holds it verbatim as a line), so a
 *  kept line explains and a new one, or a piece of a tree line, flags (user, 2026-10-19). Elsewhere, what
 *  the round served, a whole matched path that `explains` (the round's own tree spells it, at any
 *  escaping level) is explained, not flagged, and so is bare /tmp (Claude Code's own environment note
 *  names it). → {flagged, explained}: [{source, label, count, paths}]. */
export function scanContamination(sources, roots, { mask = [], explains = () => false, lineExplains = () => false, tmp, written = [], byLine = [] } = {}) {
  const masks = mask.flatMap((m) => pathSpellings(m, tmp).map((s) => s.text)).sort((a, b) => b.length - a.length);
  const blank = (t) => masks.reduce((s, m) => s.replace(new RegExp(esc(m), 'gi'), ROUND_MASK), t);
  // A spelling ends at a separator or a non-name character: C:\Users\u\code2 is not the workspace.
  const patterns = roots.map(({ path, label }) => ({
    label,
    spellings: pathSpellings(path, tmp).map(({ text: v, sep, alias }) => ({ v, alias, re: new RegExp(`${alias ? ALIAS_START : ''}${esc(v)}${RIGHT}(?:${NAME}|${sep})*`, 'gi') })),
  }));
  const flagged = [];
  const explained = [];
  for (const [source, raw] of Object.entries(sources)) {
    const wrote = written.includes(source);
    const lined = byLine.includes(source);
    const chunks = (lined ? raw.split('\n').map((l) => l.replace(/\r$/, '')) : [raw]).map((line) => ({ line, text: blank(line) }));
    for (const { label, spellings } of patterns) {
      const hits = { flagged: [], explained: [] };
      for (const { line, text } of chunks) {
        for (const { v, alias, re } of spellings) {
          for (const [m] of text.matchAll(re)) {
            const whole = m.replace(/\.+$/, '');
            const bare = alias && whole.replace(/\/+$/, '').toLowerCase() === v.toLowerCase();
            const ok = lined ? lineExplains(line) : !wrote && (bare || [whole, halve(whole), halve(halve(whole))].some(explains));
            hits[ok ? 'explained' : 'flagged'].push(unescaped(whole));
          }
        }
      }
      for (const kind of ['flagged', 'explained']) {
        if (hits[kind].length) (kind === 'flagged' ? flagged : explained).push({ source, label, count: hits[kind].length, paths: [...new Set(hits[kind])].slice(0, 5) });
      }
    }
  }
  return { flagged, explained };
}

const TOOL_CALLS = new Set(['tool_use', 'server_tool_use']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const EDIT_FIELDS = ['old_string', 'new_string', 'content'];

/** An Edit, Write or MultiEdit input split into the text of its content fields (top level and each of
 *  `edits`, in order) and the rest (its file_path and flags). */
function editParts(input) {
  const texts = [];
  const take = (o) => {
    const rest = { ...o };
    for (const k of EDIT_FIELDS) {
      if (typeof o[k] !== 'string') continue;
      texts.push(o[k]);
      delete rest[k];
    }
    return rest;
  };
  const rest = take(input);
  if (Array.isArray(input.edits)) rest.edits = input.edits.map((e) => (e && typeof e === 'object' ? take(e) : e));
  return { texts, rest };
}

/** A Claude Code transcript (jsonl) in three parts: `inputs`, every tool call's input wherever a line
 *  records it (the commands, paths and patterns the session wrote; a request blob or a subagent's
 *  progress line repeats them); `edits`, the content fields an Edit, Write or MultiEdit carries
 *  (old_string, new_string, content), as the text itself, JSON escaping undone; and `served`, the rest
 *  (tool results, loaded instructions, hook output, the model's prose). inputs and served keep the
 *  jsonl's JSON escaping. A line that isn't JSON goes to inputs whole: what the session wrote in it
 *  can't be told apart. */
export function transcriptParts(text) {
  const inputs = [];
  const edits = [];
  const served = [];
  const strip = (o) => {
    if (Array.isArray(o)) return o.map(strip);
    if (!o || typeof o !== 'object') return o;
    if (TOOL_CALLS.has(o.type) && 'input' in o) {
      if (o.type === 'tool_use' && EDIT_TOOLS.has(o.name) && o.input && typeof o.input === 'object' && !Array.isArray(o.input)) {
        const { texts, rest } = editParts(o.input);
        edits.push(...texts);
        inputs.push(JSON.stringify(rest));
      } else inputs.push(JSON.stringify(o.input));
      return { ...o, input: null };
    }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, strip(v)]));
  };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      inputs.push(line);
      continue;
    }
    served.push(JSON.stringify(strip(j)));
  }
  return { inputs: inputs.join('\n'), edits: edits.join('\n'), served: served.join('\n') };
}

/** The lines a unified diff adds, read hunk by hunk: what the session wrote, not context the repo
 *  already held or file headers. A binary hunk has no lines, so it isn't scanned. */
export function addedLines(diff) {
  const out = [];
  let left = { old: 0, new: 0 };
  for (const l of diff.split('\n')) {
    const h = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(l);
    if (h) left = { old: Number(h[1] ?? 1), new: Number(h[2] ?? 1) };
    else if (!left.old && !left.new) continue;
    else if (l.startsWith('+')) {
      out.push(l);
      left.new--;
    } else if (l.startsWith('-')) left.old--;
    else if (l.startsWith(' ')) {
      left.old--;
      left.new--;
    }
  }
  return out.join('\n');
}

/** The (ticket, arm, run) rounds matching --only / --arm / --run, in ticket, run, arm order. */
export function selectRounds(manifest, { only, arm, run } = {}) {
  const tickets = only ? manifest.tickets.filter((t) => t.id === only) : manifest.tickets;
  if (only && !tickets.length) throw new Error(`unknown ticket ${only} (have: ${manifest.tickets.map((t) => t.id).join(', ')})`);
  if (arm !== undefined && !ARMS.includes(arm)) throw new Error(`arm must be one of ${ARMS.join(', ')}, got ${JSON.stringify(arm)}`);
  const n = run === undefined ? null : Number(run);
  if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= manifest.runsPerArm)) throw new Error(`run must be 1..${manifest.runsPerArm}, got ${JSON.stringify(run)}`);
  const rounds = [];
  for (const t of tickets) {
    for (let r = 1; r <= manifest.runsPerArm; r++) {
      if (n !== null && r !== n) continue;
      for (const a of ARMS) if (arm === undefined || a === arm) rounds.push({ ticket: t, arm: a, run: r });
    }
  }
  return rounds;
}

const round2 = (x) => Math.round(x * 100) / 100;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** A ticket's size against the set's median PR, clamped to 0.5..4. */
function sizeFactor(ticket, manifest) {
  const lines = manifest.tickets.map((t) => t.lines).sort((a, b) => a - b);
  const mid = lines.length / 2;
  const median = lines.length % 2 ? lines[Math.floor(mid)] : (lines[mid - 1] + lines[mid]) / 2;
  return round2(Math.min(4, Math.max(0.5, ticket.lines / median)));
}

/** Expected $ and turns for one round: this ticket's measured runs (max), else other measured runs
 *  scaled by size, else the manifest's per-run prior scaled by size against the set's mean size, so
 *  the set's prior total stays the plan's. `measured`: [{ticketId, costUsd, turns}]. */
export function estimateRound(ticket, manifest, measured) {
  const f = sizeFactor(ticket, manifest);
  const own = measured.filter((r) => r.ticketId === ticket.id && r.costUsd !== null);
  if (own.length) return { usd: round2(Math.max(...own.map((r) => r.costUsd))), turns: Math.max(...own.map((r) => r.turns ?? 0)), basis: `max of ${own.length} measured run(s) of this ticket` };
  const known = measured.filter((r) => r.costUsd !== null && manifest.tickets.some((t) => t.id === r.ticketId));
  if (known.length) {
    const per = (key) => mean(known.map((r) => (r[key] ?? 0) / sizeFactor(manifest.tickets.find((t) => t.id === r.ticketId), manifest)));
    return { usd: round2(per('costUsd') * f), turns: Math.round(per('turns') * f), basis: `scaled from ${known.length} measured run(s), size factor ${f}` };
  }
  const meanF = round2(mean(manifest.tickets.map((t) => sizeFactor(t, manifest))));
  return { usd: round2((manifest.prior.usdPerRun * f) / meanF), turns: Math.round((manifest.prior.turnsPerRun * f) / meanF), basis: `prior (${manifest.prior.source}), size factor ${f} of mean ${meanF}` };
}

/** The git steps that put `sha` and its history alone into a fresh repo at `dest`: fetch, then check
 *  out. A clone would bring main, and main holds the fix. round.mjs's fetchCheckout runs them; the
 *  dry run prints them. */
export const checkoutSteps = (source, sha, dest) => [
  ['git', 'init', '--quiet', dest],
  ['git', '-C', dest, 'fetch', '--quiet', '--no-tags', source, sha],
  ['git', '-C', dest, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'],
];

/** Everything one round does, with no side effects: the dry run prints it, round.mjs carries it out. */
export function planRound(manifest, ticket, arm, run, { tmp, workspace, out, roundId }, measured) {
  const layout = roundLayout(ticket, roundId, { tmp, workspace });
  const source = join(workspace, ticket.path);
  const estimate = estimateRound(ticket, manifest, measured);
  const budgetUsd = Math.ceil(2 * estimate.usd);
  return {
    ticket,
    arm,
    run,
    layout,
    source,
    harnessSource: join(workspace, HARNESS_PATH),
    resultsDir: join(out, 'runs', ticket.id, `${arm}-r${run}`),
    fetch: checkoutSteps(source, ticket.parent, layout.checkout),
    claude: { args: claudeArgs(arm, { model: manifest.model, effort: manifest.effort, permissionMode: manifest.permissionMode, budgetUsd }) },
    gates: ticket.gates,
    estimate: { ...estimate, budgetUsd },
  };
}
