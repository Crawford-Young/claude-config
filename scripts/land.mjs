#!/usr/bin/env node
// land.mjs — the claude-config commit lane, mechanized.
//
// The main checkout of claude-config is the live junction/routing surface: it
// never leaves main and never commits. Every commit lands via an ephemeral
// worktree cut from origin/main, carrying ONLY a path-scoped diff of your
// files (concurrent sessions' live edits stay behind).
//
//   node land.mjs start <slug> -m "commit message" -- <path> [path...]
//   node land.mjs sync -- <path> [path...]     (after the PR merges)
//   node land.mjs finish <slug>                (remove the ephemeral worktree)
//
// start: fetch → worktree add chore/<slug> from origin/main → apply the main
//        checkout's diff for the named paths (untracked files copied) →
//        commit. Pushing and opening the PR stay with the user's approval.
// sync:  verify the live edits match origin/main for those paths, then
//        restore tracked copies and fast-forward the main checkout. Untracked
//        copies of incoming additions (named or not) are adopted if identical,
//        refused before any reset if not. Other sessions' live edits in files
//        the incoming commits also touch are saved as patches, reset, and
//        3-way re-applied after the merge.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  currentBranch,
  die,
  git,
  gitOrDie,
  log,
  parseArgs,
  workspaceRoot,
  worktreesDir,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const cfg = process.env.CLAUDE_CONFIG_REPO || join(workspaceRoot(), 'claude-config');

if (!existsSync(join(cfg, '.git'))) die(`claude-config repo not found at ${cfg} (set CLAUDE_CONFIG_REPO to override)`);

if (cmd === 'start') cmdStart();
else if (cmd === 'sync') cmdSync();
else if (cmd === 'finish') cmdFinish();
else die('usage: land.mjs start <slug> -m "msg" -- <paths...> | sync -- <paths...> | finish <slug>');

function paths() {
  const p = args._.slice(cmd === 'start' ? 2 : 1);
  if (p.length === 0) die('name the file paths after `--` — a path-scoped diff is the whole point');
  return p;
}

function cmdStart() {
  const slug = args._[1];
  const msg = args.m || args.message;
  if (!slug || !msg) die('usage: land.mjs start <slug> -m "commit message" -- <paths...>');
  const files = paths();

  const branch = currentBranch(cfg);
  if (branch !== 'main' && branch !== 'master') {
    die(`main checkout is on "${branch}" — the live-routing protocol requires it on main. Fix that first.`);
  }

  gitOrDie(cfg, ['fetch', 'origin']);
  const wt = join(worktreesDir(), `claude-config-${slug}`);
  if (existsSync(wt)) die(`worktree already exists: ${wt} (land.mjs finish ${slug} first?)`);
  mkdirSync(worktreesDir(), { recursive: true });
  gitOrDie(cfg, ['worktree', 'add', wt, '-b', `chore/${slug}`, 'origin/main']);

  // Apply the path-scoped diff of YOUR files only.
  //
  // Deliberately NOT via lib.mjs's git(): that helper trims stdout, and a patch
  // is whitespace-significant to the byte. A context line for a blank line is a
  // single space, so a diff whose last changed file ends in a blank line ends
  // with " \n" — and trim() destroys exactly that, leaving the hunk one line
  // short of the count in its own @@ header. git then reports "corrupt patch at
  // <n>" pointing one line PAST the end of the patch, which reads like a
  // delivery or encoding fault and is not one. Verified: raw diff applies
  // (exit 0), the same diff trimmed fails at :198. Cost two workstreams a
  // manual land before it was diagnosed.
  const diff = spawnSync('git', ['-C', cfg, 'diff', '--binary', 'HEAD', '--', ...files], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (diff.status !== 0) die(`diff failed: ${diff.stderr}`);
  const patch = diff.stdout ?? '';
  if (patch.trim()) {
    const apply = spawnSync('git', ['-C', wt, 'apply', '--index', '-'], { input: patch, encoding: 'utf8' });
    if (apply.status !== 0) die(`git apply failed in ${wt}:\n${apply.stderr}`);
  }
  // Untracked new files are invisible to diff — copy them explicitly.
  for (const f of files) {
    const tracked = git(cfg, ['ls-files', '--error-unmatch', f]).code === 0;
    const src = join(cfg, f);
    if (!tracked && existsSync(src)) {
      mkdirSync(dirname(join(wt, f)), { recursive: true });
      cpSync(src, join(wt, f), { recursive: true });
      gitOrDie(wt, ['add', f]);
    }
  }

  const staged = git(wt, ['diff', '--cached', '--stat']);
  if (!staged.out) die('nothing staged — are the named paths actually modified on the main checkout?');
  gitOrDie(wt, ['commit', '-m', msg]);
  log(`committed on chore/${slug} in ${wt}:`);
  log(staged.out);
  log('next: get user approval, then push (git push -u origin chore/' + slug + ') and open the PR (rebase-merge).');
}

// A path the PR ADDED is untracked on the main checkout but present in
// origin/main, and the tracked-path machinery mishandles it twice:
// `git diff origin/main` has no index entry to compare against and reports it
// as a deletion (spurious drift), and `git restore --source=HEAD` dies outright
// on a path HEAD never had. Classify those paths separately.
//
// Returns { tracked, adopt }: `adopt` is the untracked-but-identical set, whose
// local copy is deleted so the fast-forward can create it. Dies on real drift.
function classifySyncPaths(files) {
  const tracked = [];
  const adopt = [];
  for (const f of files) {
    if (git(cfg, ['ls-files', '--error-unmatch', f]).code === 0) {
      tracked.push(f);
      continue;
    }
    const remote = git(cfg, ['rev-parse', `origin/main:${f}`]);
    // Untracked here AND absent from origin/main: someone else's in-flight
    // file (agents/manager.md was exactly this). Not ours — leave it alone.
    if (remote.code !== 0) continue;
    // Nothing on disk: no conflict, the fast-forward just creates it.
    if (!existsSync(join(cfg, f))) continue;
    // Compare GIT-NORMALIZED, never byte-for-byte. This repo sets
    // core.autocrlf=true with `* text=auto`, so every text file is CRLF on disk
    // and LF in the blob — _hooklib.mjs is 1948 bytes on disk and 1890 as a
    // blob while `git status` calls it clean. A raw byte compare therefore
    // reports drift for every text file and this branch would never fire.
    // `hash-object --path` applies the same filters git applies on checkin.
    const local = git(cfg, ['hash-object', '--path', f, '--', f]);
    if (local.code !== 0) {
      die(`cannot hash local ${f} to compare against origin/main:\n${local.err}`);
    }
    if (local.out !== remote.out) {
      die(
        `untracked local ${f} differs from origin/main — reconcile before syncing (never discard):\n` +
          `  local  ${local.out}\n  origin ${remote.out}`,
      );
    }
    adopt.push(f);
  }
  return { tracked, adopt };
}

// NUL-separated git output as a list. -z output is never quoted, so paths with
// spaces or non-ASCII survive (git()'s trim() could only clip a path that
// starts with whitespace — not a shape this repo has).
function zList(repo, args) {
  const r = git(repo, [...args, '-z']);
  if (r.code !== 0) die(`git ${args.join(' ')} failed in ${repo}:\n${r.err || r.out}`);
  return r.out.split('\0').filter(Boolean);
}

// Paths HEAD..origin/main ADDS that already sit untracked on disk, whether or
// not the caller named them. The named list can't be trusted to cover these:
// claude-config#175's caller built it before sync's own fetch, so it named the
// previous commit's paths, the PR's two new files were never classified, and
// `merge --ff-only` aborted over them. Deriving them here makes the check a
// precondition. Each goes through classifySyncPaths' untracked branch: adopted
// if identical, a die() before any reset if not. A path staged in the index is
// left out — it is tracked, and ff-only refusing over it is the right answer.
function incomingAdditions(named) {
  const skip = new Set(named);
  return zList(cfg, ['diff', '--name-only', '--diff-filter=A', '--no-renames', 'HEAD', 'origin/main']).filter(
    (f) =>
      !skip.has(f) && existsSync(join(cfg, f)) && git(cfg, ['ls-files', '--error-unmatch', f]).code !== 0,
  );
}

// Another session's uncommitted edit in a file the incoming range also touches
// makes `merge --ff-only` refuse. Those are the paths to carry across the merge:
// locally modified (worktree or index vs HEAD), touched by HEAD..origin/main,
// and not one of the named paths (cmdSync restores those outright, having
// verified them equal to origin/main).
//
// Only an edit that one worktree patch fully represents is safe to reset, so
// two cases are refused here, before anything has been touched:
// - staged changes: the index and the worktree can hold two different states
//   of the file and one patch can't carry both. The main checkout never
//   commits, so a staged change is someone's deliberate, unusual state.
// - an incoming deletion (a rename is a deletion under --no-renames): there is
//   no file left to re-apply onto; whether the edit should move or die is a
//   human's call.
function carryPaths(named) {
  const skip = new Set(named);
  const incoming = new Map();
  const status = zList(cfg, ['diff', '--name-status', '--no-renames', 'HEAD', 'origin/main']);
  for (let i = 0; i < status.length; i += 2) incoming.set(status[i + 1], status[i]);
  const carry = zList(cfg, ['diff', '--name-only', 'HEAD']).filter((f) => incoming.has(f) && !skip.has(f));
  if (carry.length === 0) return carry;

  const staged = new Set(zList(cfg, ['diff', '--cached', '--name-only', 'HEAD']));
  const refuse = [
    ...carry.filter((f) => staged.has(f)).map((f) => `  ${f} (staged changes)`),
    ...carry.filter((f) => incoming.get(f) === 'D').map((f) => `  ${f} (incoming commits delete it)`),
  ];
  if (refuse.length) {
    die(
      `incoming commits touch locally-modified paths sync can't carry — nothing was reset; reconcile by hand:\n` +
        refuse.join('\n'),
    );
  }
  return carry;
}

// Save each carried path's worktree diff to its own patch file under the git
// dir (not the worktree, where it would show up as untracked). Patches are
// written and read back BEFORE any reset, so every later failure branch still
// has the edit on disk. Raw spawnSync, not git(): a patch is whitespace-
// significant to the byte (see cmdStart).
function saveCarryPatches(carry) {
  const gitDir = gitOrDie(cfg, ['rev-parse', '--absolute-git-dir']);
  const dir = join(gitDir, 'land-sync-carry', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(dir, { recursive: true });
  return carry.map((path, i) => {
    const diff = spawnSync('git', ['-C', cfg, 'diff', '--binary', 'HEAD', '--', path], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (diff.status !== 0) die(`diff failed for ${path} — nothing was reset:\n${diff.stderr}`);
    const file = join(dir, `${i}-${basename(path)}.patch`);
    writeFileSync(file, diff.stdout);
    if (readFileSync(file, 'utf8') !== diff.stdout) die(`could not save ${file} intact — nothing was reset`);
    return { path, file, empty: !diff.stdout.trim() };
  });
}

// Re-apply saved patches; returns the ones that did not apply cleanly. --3way
// stages a clean result, so the path's index entry goes back to HEAD to leave
// the edit exactly as it was: unstaged. A conflict leaves markers in the
// worktree; its unmerged index entry is reset too, so the shared checkout's
// index stays operable for every other session (the patch keeps the original).
function applyCarryPatches(saved, threeWay) {
  const failed = [];
  for (const p of saved) {
    if (p.empty) continue;
    const r = git(cfg, ['apply', ...(threeWay ? ['--3way'] : []), p.file]);
    if (threeWay) git(cfg, ['reset', '-q', '--', p.path]);
    if (r.code === 0) rmSync(p.file);
    else failed.push({ ...p, err: r.err || r.out });
  }
  return failed;
}

// A function declaration, not a const: the command dispatch at the top of this
// module runs before any const below it is initialized.
function describeKept(kept) {
  return kept.map((p) => `  ${p.path}  <- edit saved at ${p.file}`).join('\n');
}

function cmdSync() {
  const files = paths();
  gitOrDie(cfg, ['fetch', 'origin']);
  const { tracked, adopt } = classifySyncPaths([...files, ...incomingAdditions(files)]);

  if (tracked.length) {
    const drift = git(cfg, ['diff', 'origin/main', '--numstat', '--', ...tracked]);
    if (drift.out) {
      die(`live edits differ from origin/main for these paths — reconcile before syncing (never discard):\n${drift.out}`);
    }
  }
  if (git(cfg, ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']).code !== 0) {
    die('HEAD is not an ancestor of origin/main — a fast-forward is impossible; nothing was reset.');
  }
  const saved = saveCarryPatches(carryPaths(tracked));

  // Every precondition has passed and every carried edit is on disk — only now
  // reset anything. A die() above must not leave the checkout half-reverted.
  const reset = [...tracked, ...saved.map((p) => p.path)];
  if (reset.length) {
    const r = git(cfg, ['restore', '--source=HEAD', '--worktree', '--', ...reset]);
    if (r.code !== 0) die(`git restore failed:\n${r.err}${saved.length ? `\ncarried edits are saved:\n${describeKept(saved)}` : ''}`);
  }
  for (const f of adopt) rmSync(join(cfg, f), { force: true });

  const merge = git(cfg, ['merge', '--ff-only', 'origin/main']);
  if (merge.code !== 0) {
    // Still on the old HEAD the patches were cut from: they apply as-is.
    const kept = applyCarryPatches(saved, false);
    if (saved.length && !kept.length) rmSync(dirname(saved[0].file), { recursive: true, force: true });
    die(
      `merge --ff-only stopped:\n${merge.err || merge.out}\nReconcile by hand.` +
        (saved.length ? ` Carried edits were put back${kept.length ? `, except:\n${describeKept(kept)}` : '.'}` : ''),
    );
  }

  const conflicts = applyCarryPatches(saved, true);
  if (conflicts.length) {
    die(
      `main checkout synced to origin/main, but carrying a live edit hit a 3-way conflict in:\n${describeKept(conflicts)}\n` +
        'The worktree file holds conflict markers; the patch holds the original edit. Resolve by hand.',
    );
  }
  if (saved.length) {
    rmSync(dirname(saved[0].file), { recursive: true, force: true });
    log(`carried live edits across the merge: ${saved.map((p) => p.path).join(', ')}`);
  }
  log('main checkout synced to origin/main.');
}

// True if `wt` is a path git currently has registered as a worktree. A path
// can exist on disk without being registered — a prior `worktree remove` (or
// a manual prune of .git/worktrees/<name>) can drop the registration while
// leaving the directory behind (PR #50). In that state `git worktree remove`
// refuses it outright, so callers must branch on this first.
function isRegisteredWorktree(wt) {
  const list = git(cfg, ['worktree', 'list', '--porcelain']).out;
  const target = resolve(wt).replace(/\\/g, '/').toLowerCase();
  return list.split(/\n{2,}/).some((block) => {
    const m = block.match(/^worktree (.+)$/m);
    return m && resolve(m[1]).replace(/\\/g, '/').toLowerCase() === target;
  });
}

function removeFinishedWorktree(wt) {
  if (!existsSync(wt)) {
    log(`no worktree at ${wt} (already removed)`);
    return;
  }
  if (!isRegisteredWorktree(wt)) {
    // git no longer knows about this path — plain filesystem cleanup is safe
    // and correct, not a workaround for a registered worktree.
    rmSync(wt, { recursive: true, force: true });
    log(`removed leftover worktree directory ${wt} (was already unregistered)`);
    return;
  }
  let r = git(cfg, ['worktree', 'remove', wt]);
  if (r.code !== 0 && isRegisteredWorktree(wt)) r = git(cfg, ['worktree', 'remove', '--force', wt]);
  if (r.code !== 0) {
    // A Windows lock (a process with its cwd inside) makes the remove fail
    // AFTER git unregistered the worktree. The branch is then no longer
    // checked out, so the branch steps are safe; only the dir is left.
    if (isRegisteredWorktree(wt)) die(`worktree remove failed: ${r.err}\nRemove before deleting the remote branch — a checked-out branch can't be deleted.`);
    try {
      rmSync(wt, { recursive: true, force: true });
    } catch {
      // still locked — fall through to the existsSync check
    }
    if (existsSync(wt)) {
      log(`warning: unregistered worktree ${wt} but the directory is still locked — delete it once nothing holds it (is a shell's cwd inside?)`);
      return;
    }
  }
  log(`removed worktree ${wt}`);
}

// Merged-status check for a branch that PRs land via "Rebase and merge" — the
// branch's commits are never ancestors of origin/main, only patch-equivalent
// to a commit main now has. `git cherry` decides — it detects patch-equivalence
// directly, so every commit on the branch must already be on main. `gh pr view`
// (skipped with CLAUDE_LAND_NO_GH=1 or without gh) can only veto, when the PR
// is open or closed unmerged.
function isBranchMerged(branch, cherryRef) {
  if (!process.env.CLAUDE_LAND_NO_GH) {
    const gh = spawnSync('gh', ['pr', 'view', branch, '--json', 'state'], { cwd: cfg, encoding: 'utf8' });
    if (!gh.error && gh.status === 0 && gh.stdout) {
      try {
        // gh can only veto: a MERGED PR says nothing about commits made on the
        // branch after the merge, so the cherry check below still has to pass.
        const state = JSON.parse(gh.stdout).state;
        if (state && state !== 'MERGED') return false;
      } catch {
        // unparseable gh output — fall through to the cherry check
      }
    }
  }
  const cherry = git(cfg, ['cherry', 'origin/main', cherryRef]);
  if (cherry.code !== 0) return false; // can't tell — never force-delete unmerged work
  return cherry.out
    .split('\n')
    .filter(Boolean)
    .every((line) => !line.startsWith('+'));
}

function cmdFinish() {
  const slug = args._[1];
  if (!slug) die('usage: land.mjs finish <slug>');
  const branch = `chore/${slug}`;
  const wt = join(worktreesDir(), `claude-config-${slug}`);

  removeFinishedWorktree(wt);
  gitOrDie(cfg, ['worktree', 'prune']);

  gitOrDie(cfg, ['fetch', 'origin']);
  const localExists = git(cfg, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).code === 0;
  const remoteExists = git(cfg, ['ls-remote', '--exit-code', '--heads', 'origin', branch]).code === 0;

  if (!localExists && !remoteExists) {
    log(`no branch ${branch} to clean up (already removed)`);
    return;
  }

  const merged = isBranchMerged(branch, localExists ? branch : `origin/${branch}`);

  if (localExists) {
    if (merged) {
      let del = git(cfg, ['branch', '-d', branch]);
      // -d's ancestor check can still refuse a rebase-merged branch even
      // though `git cherry` independently confirmed it's patch-equivalent —
      // -D is safe here because merged status was already verified above.
      if (del.code !== 0) del = git(cfg, ['branch', '-D', branch]);
      if (del.code !== 0) die(`local branch delete failed for ${branch}: ${del.err}`);
      log(`deleted local branch ${branch}`);
    } else {
      log(`kept local branch ${branch} — not merged into origin/main`);
    }
  }

  if (remoteExists) {
    if (merged) {
      const del = git(cfg, ['push', 'origin', '--delete', branch]);
      if (del.code !== 0 && !/remote ref does not exist/i.test(del.err)) {
        die(`remote branch delete failed for ${branch}: ${del.err}`);
      }
      log(`deleted remote branch origin/${branch}`);
    } else {
      log(`kept remote branch origin/${branch} — not merged into origin/main`);
    }
  }
}
