# CLAUDE.md — Apps Domain Standards

Adds the mobile/desktop stack. Applies to every project under `~/code/apps/`.

## Stack (verified: 2026-10, #80, #89)

| Concern | Mobile (Expo) | Desktop (Tauri) |
|---|---|---|
| Platform | Expo (React Native) | Tauri v2 + Rust (rustfmt/clippy) |
| Navigation | Expo Router | — |
| Styling | NativeWind | Tailwind v4 (`@tailwindcss/vite`) + `@crawfordyoung/ui` |
| Theme | Dark+light, dark-first | dark-only (strate) |
| Testing | Jest + React Native Testing Library | Vitest, 100% coverage |
| E2E | Maestro | — |
| State | TanStack Query + Zustand | — |
| Build/ship | EAS Build + EAS Submit | `bun run build` → `tauri build --debug --no-bundle` |
| Error monitoring | Sentry | — |

| Concern | Shared |
|---|---|
| Language | TypeScript 6 strict — no `any`, no `@ts-ignore` without justification |
| Package manager | Bun (pm+runtime); `pnpm-lock.yaml`→pnpm til #110 — never npm or yarn |
| Commits | Conventional Commits (commitlint) |

## Differs From Web (Expo)

Each is a habit to actively unlearn, not just a swapped tool name:

- **Expo Router, not App Router** — client-side routing only; no server to render on.
- **No RSC, no Server Actions** — no Node server; the backend is a separate service, every mutation through a typed API client.
- **NativeWind, not raw Tailwind** — Tailwind syntax compiled to RN `StyleSheet`; no DOM or CSS engine on-device.
- **Jest + RNTL, not Vitest** — Metro bundler and native-module mocks need Jest's RN preset.
- **Maestro, not Playwright** — no browser to drive; Maestro drives the app through the OS's UI-automation layer.
- **EAS, not Vercel** — ships as a signed binary through app-store review.

## Definition of Done

- [ ] (Expo) React Native Testing Library — 100% coverage on logic
- [ ] (Expo) Maestro — all E2E flows green
- [ ] TypeScript — zero errors (`tsc --noEmit`)
- [ ] ESLint + Prettier — zero errors or formatting diffs
- [ ] (Expo) EAS preview build runs on a physical device
- [ ] (Expo) Both themes verified on-device
- [ ] Accessibility labels pass a screen-reader pass
- [ ] (Expo) Sentry — integrated and reporting
- [ ] (Tauri) `bun run test` 100% + `bun run build` clean; cargo fmt/clippy/test clean; `tauri build` succeeds
