# CLAUDE.md — Apps Domain Standards

**Inherits:** `~/code/CLAUDE.md` (universal rules — workflow, git, planning discipline, security). This file adds the mobile/desktop stack on top and overrides it only where explicitly stated.

Applies to every project under `~/code/apps/`.

---

## Stack (key decisions)

| Concern | Tool |
|---|---|
| Mobile | Expo (React Native) |
| Desktop | Tauri v2 |
| Language | TypeScript strict — no `any`, no `@ts-ignore` without justification |
| Navigation | Expo Router — file-based routing |
| Styling | NativeWind — Tailwind class syntax compiled to native styles |
| Client async state | TanStack Query |
| UI state | Zustand |
| Validation | Zod |
| Testing | Jest + React Native Testing Library |
| E2E | Maestro |
| Build/ship | EAS Build + EAS Submit |
| Error monitoring | Sentry |
| Package manager | pnpm — never npm or yarn |
| Commits | Conventional Commits — enforced by commitlint |

---

## Carries Over Unchanged From Web

No re-derivation needed — these apply exactly as written in `web/CLAUDE.md`:

- TypeScript strict, no `any`
- Zod at all system boundaries
- TanStack Query for all client-side async state
- Zustand for UI state only — never as a data cache
- Conventional Commits
- Dark mode by default — every component designed and tested in dark mode first

---

## Differs From Web

Each of these is a habit to actively unlearn, not just a swapped tool name:

- **Expo Router, not App Router** — file-based routing is the same idea, but Expo Router resolves routes client-side only; there is no server to render on.
- **No RSC and no Server Actions** — a React Native app has no Node server process to run them on. The backend is a separate service; every mutation goes through a typed API client instead.
- **NativeWind, not raw Tailwind** — NativeWind compiles Tailwind class syntax into React Native `StyleSheet` objects. There is no DOM or CSS engine on-device, so raw Tailwind (which emits CSS) does not apply here.
- **Jest + RNTL, not Vitest** — React Native's Metro bundler and native-module mocks need Jest's RN preset; Vitest's transform pipeline targets browser/Node ESM and doesn't ship one.
- **Maestro, not Playwright** — Playwright drives a browser over CDP; there is no browser here. Maestro drives the actual installed iOS/Android app through the platform's native UI-automation layer.
- **EAS, not Vercel** — Vercel deploys server-rendered or static web output; a mobile app ships as a signed binary through app-store review, which is what EAS Build/Submit exists to manage.
- **No Lighthouse** — Lighthouse audits page-load web vitals inside a browser. The equivalent perf gate here is cold-start time and sustained frame rate, measured on a physical device.

---

## Definition of Done

- [ ] React Native Testing Library — 100% coverage on logic
- [ ] Maestro — all E2E flows green
- [ ] TypeScript — zero errors (`tsc --noEmit`)
- [ ] ESLint + Prettier — zero errors or formatting diffs
- [ ] EAS preview build installs and runs on a physical device
- [ ] Both themes (dark + light) verified on-device
- [ ] Accessibility labels present and pass a screen-reader pass
- [ ] Sentry — integrated and reporting
- [ ] README.md + repo CLAUDE.md updated
- [ ] Phase boundary: `claude-md-management:reflect` run before requesting push/PR

Run `superpowers:verification-before-completion` before declaring anything done.

---

## Tauri Note

No desktop project exists yet under this domain. When the first one starts, brainstorm whether it shares a codebase with the Expo app — Tauri hosts a web frontend, which opens a real option to share business logic with an Expo/RN app — or is built as a fully separate repo. Do not assume either shape going in.
