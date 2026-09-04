---
name: visual-asset-gates
description: Images, brand assets, SVGs, palettes/themes, screenshots, and preview gates — use when generating or iterating on images and brand assets, tracing or emitting SVGs, deciding palettes or themes, capturing screenshots, or running the preview gate before user QA, including while still scoping or planning such work, since art direction and composition are per-asset user gates rather than plan-locked decisions.
---

# Visual & Asset Gates

Aesthetic decisions are user gates, not plan-locked prose. Plans lock pipeline, sizes, and palette — never *look*.

## Universal

- Per-asset user gates with rendered references. Composition, mark form, and copy placement get rejected on sight when plan-locked. Art direction anchors on the user's shipped, liked assets on adjacent surfaces — never on spec adjectives or a recon test render. Two consecutive direction rejections → stop generating, re-anchor on shipped assets.
- Organic/illustrative shapes are never hand-authored SVG paths — trace a user-approved raster (potrace) from the start; carry `fill-rule` when re-emitting. No "simple geometric" exception; hero/identity surfaces (emotes, badges, alerts) go raster-gen, not CSS-composed.
- Animation whose correctness is its time-ordering needs multi-frame capture (2–3 mid-animation timestamps) or live eyes — single end-state screenshots can't see sequencing bugs.
- Sheet batching on quota-priced image models is mandatory — N same-style assets = one labeled, gapped contact sheet per gen. Plan the split/strip step from the start (models bake checkerboard "transparency" as opaque pixels); measure the real inter-asset gap before setting split thresholds. Generation routes are quota-gated external deps — sequence gen tasks early, keep non-gen tasks as fill for stall windows.
- Packaging/CTR surfaces (thumbnails, titles, hooks) optimize for click-through, not brand consistency — get the user's packaging direction before rendering.
- Theme/palette work asks "where does color live" (interactive elements vs surfaces vs grounds) as an explicit gate question with rendered candidates; ambiguous feel-words in feedback get one clarifying read-back before the next round.
- Data-driven graphics commit their generator + data into the asset repo — scratchpad generators die with the session.
- Transparent-bg PNG export needs a node script with `page.screenshot({ omitBackground: true })` — the Playwright CLI can't.
- CSS-var-override preview capture waits ~400ms after style injection (`transition-colors` screenshots stale colors otherwise).

## Web preview gate

- Color/token/design-system changes: open Storybook, verify dark + light visually, then write tests.
- Preview gate on a running app starts with **apply pending DB migrations** — and verify against the live DB afterward (`to_regclass`); a migrate can report success while applying nothing.
- Two passes before claiming QA-ready: the scripted spec-path playthrough AND a naive-user exploratory pass over every visible control on each changed surface. A wave that removes/hides an affordance presents the removed-affordance list at the QA prompt.
- Authed-surface QA runs on the user's real signed-in browser session (claude-in-chrome) — scripted session-token minting is classifier-blocked; if a token is unavoidable, hand the user the mint script to run themselves.
- Console-cleanliness capture scripts screenshot only after `networkidle` (or pass `caret: 'initial'`) — earlier captures fabricate hydration-mismatch errors.
