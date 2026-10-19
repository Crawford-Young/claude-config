// Blinding for #271 grading: strips what tells the two arms apart from a run's diff and gate output.
// Both arms share one layout under <tmp>/ab/<round id>, so a path names no arm; still, every round
// path is replaced in each spelling a log can carry it. The other tells: the safe-mode flag and env
// var, an arm label, harness-workflow files (COMMIT_MSG_<n>.txt, dropped whole) and commit-body
// vocabulary. Redactions share one placeholder in both arms. Harness file names stay: every ticket is a
// claude-config ticket (round 5), so the repo holds them and a mention says nothing about the arm.

const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SAFE_MODE = /CLAUDE_CODE_SAFE_MODE(?:=\S*)?|(?:--)?safe[-_ ]?mode/gi;
const ARM_LABEL = /-(?:bare|current)-r(\d+)\b/gi;
const TEMP_PATH = /AppData[\\/]+Local[\\/]+Temp/i;
// An added commit-body line, plain, bold or bulleted: `+What:`, `+**What:**`, `+- Verified:`, `+  * **Next:**`.
const COMMIT_VOCAB = /^\+[ \t]*(?:[-*][ \t]+)?(?:\*\*)?(?:What|Verified|Next|Ruled out):/m;
const REDACTED = '<redacted>';

/** A path in each spelling a log can carry it: JSON-escaped, backslash, forward slash, git-bash,
 *  git-bash's /tmp alias when it sits under `tmp`, and the transcript project key. */
export function pathVariants(p, tmp) {
  const fwd = p.replace(/\\/g, '/');
  const bash = fwd.replace(/^([A-Za-z]):\//, (_, d) => `/${d.toLowerCase()}/`);
  const t = tmp?.replace(/\\/g, '/').replace(/\/+$/, '');
  const alias = t && fwd.toLowerCase().startsWith(`${t.toLowerCase()}/`) ? [`/tmp${fwd.slice(t.length)}`] : [];
  return [...new Set([p.replace(/\\/g, '\\\\'), p, fwd, bash, ...alias, p.replace(/[^A-Za-z0-9]/g, '-')])];
}

/** `diff` without the file sections of harness-workflow files (COMMIT_MSG_<n>.txt and the like). */
export function dropFiles(diff) {
  return diff
    .split(/(?=^diff --git )/m)
    .filter((s) => !/^diff --git a\/(?:\S*\/)?commit_msg[^/\s]*\s/i.test(s))
    .join('');
}

/** `text` with roots ({path, label}, longest first, any case, every spelling) replaced, and safe-mode
 *  and arm labels redacted. */
export function anonymize(text, { roots = [], tmp }) {
  let out = text;
  const variants = roots.flatMap(({ path, label }) => pathVariants(path, tmp).map((v) => ({ v, label })));
  for (const { v, label } of variants.sort((a, b) => b.v.length - a.v.length)) out = out.replace(new RegExp(ESC(v), 'gi'), label);
  return out.replace(SAFE_MODE, REDACTED).replace(ARM_LABEL, '-<arm>-r$1');
}

/** Identifying patterns still present in `text`: [{pattern, sample}]. Empty means it is safe to show a grader. */
export function leaks(text, { roots = [], tmp }) {
  const found = [];
  const hit = (pattern, re) => {
    const m = re.exec(text);
    if (m) found.push({ pattern, sample: m[0] });
  };
  for (const { path, label } of roots) {
    for (const v of pathVariants(path, tmp)) hit(label, new RegExp(ESC(v), 'i'));
  }
  hit('temp path', TEMP_PATH);
  hit('safe-mode', new RegExp(SAFE_MODE.source, 'i'));
  hit('arm label', new RegExp(ARM_LABEL.source, 'i'));
  hit('commit-body vocabulary', COMMIT_VOCAB);
  return found;
}
