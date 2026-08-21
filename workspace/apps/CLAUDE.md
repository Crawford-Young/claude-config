# CLAUDE.md — Apps Domain Standards

**Inherits:** `~/code/CLAUDE.md` (universal rules). Adds the mobile/desktop stack; overrides only where explicitly stated. Applies to every project under `~/code/apps/`.

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

TypeScript strict/no `any` · Zod at all system boundaries · TanStack Query for client async state · Zustand for UI state only · Conventional Commits · dark mode by default (designed and tested dark-first).

---

## Differs From Web

Each is a habit to actively unlearn, not just a swapped tool name:

- **Expo Router, not App Router** — routes resolve client-side only; there is no server to render on.
- **No RSC, no Server Actions** — no Node server process; the backend is a separate service, every mutation goes through a typed API client.
- **NativeWind, not raw Tailwind** — Tailwind syntax compiled to RN `StyleSheet`; no DOM or CSS engine on-device.
- **Jest + RNTL, not Vitest** — Metro bundler and native-module mocks need Jest's RN preset.
- **Maestro, not Playwright** — no browser to drive; Maestro drives the installed app through the platform's native UI-automation layer.
- **EAS, not Vercel** — a mobile app ships as a signed binary through app-store review.
- **No Lighthouse** — the perf gate is cold-start time and sustained frame rate on a physical device.

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


---

## Tauri Note

No desktop project exists yet. When the first one starts, brainstorm whether it shares a codebase with the Expo app (Tauri hosts a web frontend — real option to share business logic) or is a fully separate repo. Do not assume either shape going in.
