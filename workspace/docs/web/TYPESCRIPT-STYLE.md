# TypeScript Style Guide

Workspace-wide TypeScript coding standards. Derived from the
[Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
with Prettier-owned formatting rules excluded (semicolons, quotes, indentation,
trailing commas, print width).

These rules apply to every project in `~/code` unless a project-level `CLAUDE.md`
explicitly overrides a specific rule.

---

## 1. Naming Conventions

| Construct | Convention | Example |
|---|---|---|
| Variables, parameters, functions | `camelCase` | `getUserStats` |
| Classes, interfaces, type aliases, enums | `PascalCase` | `UserStats` |
| Constants (module-level, truly immutable) | `SCREAMING_SNAKE_CASE` | `MAX_RETRIES` |
| Private class members | `camelCase` (no underscore prefix) | `this.userId` |
| File names | `kebab-case` | `user-stats.ts` |
| Test files | `<subject>.test.ts` | `user-stats.test.ts` |

Do not use `_` prefixes to indicate "private" in non-class contexts.
Do not abbreviate names unless the abbreviation is universally understood (e.g. `url`, `id`, `db`).
Treat acronyms as whole words in identifiers: `loadHttpUrl`, not `loadHTTPURL`.

---

## 2. Interfaces vs Type Aliases

**Use `interface` for object shapes.** Use `type` only for unions, intersections,
mapped types, or conditional types.

```ts
// Correct — object shape uses interface
interface UserStats {
  readonly userId: string;
  readonly totalPoints: number;
  readonly currentLevel: Level;
}

// Correct — union uses type
type Level = 'seedling' | 'growing' | 'thriving' | 'flourishing' | 'evergreen';

// Wrong — object shape uses type alias
type UserStats = {
  userId: string;
};
```

Rationale: interfaces produce clearer error messages, support declaration merging,
and signal "this describes an object" at a glance.

---

## 3. `readonly` Properties

Mark properties immutable when they are never reassigned after construction.
Applies to interface properties, class members, and destructured parameters.

```ts
// Correct
interface CalendarEvent {
  readonly id: string;
  readonly start: Date;
  readonly end: Date;
  title: string; // mutable — can be renamed
}

// Wrong — all fields modifiable when they shouldn't be
interface CalendarEvent {
  id: string;
  start: Date;
  end: Date;
  title: string;
}
```

Use `ReadonlyArray<T>` instead of `T[]` for arrays that must not be mutated.

---

## 4. Explicit Return Types on Exported Functions

All exported functions and methods must declare their return type explicitly.
Internal (non-exported) functions may rely on inference when the return type is obvious.

```ts
// Correct — exported, explicit return type
export function getUserStats(userId: string): Promise<UserStats | undefined> {
  return db.query.userStats.findFirst({ where: eq(userStats.userId, userId) });
}

// Correct — internal helper, inference acceptable
function formatPoints(points: number) {
  return `${points.toLocaleString()} pts`;
}

// Wrong — exported function with no return type
export function getUserStats(userId: string) {
  return db.query.userStats.findFirst({ where: eq(userStats.userId, userId) });
}
```

---

## 5. `undefined` over `null`

Prefer `undefined` for optional/absent values. Use `null` only when interoperating
with an API that returns `null` (e.g. database drivers, external APIs).

```ts
// Correct
interface Task {
  readonly completedAt?: Date; // undefined when not complete
}

// Wrong — null for optional value
interface Task {
  completedAt: Date | null;
}
```

Exception: Drizzle ORM nullable columns return `null`. Accept `null` at the DB boundary
and convert to `undefined` in the service layer if needed.

---

## 6. No Magic Numbers

Extract numeric literals into named constants at the module or class level.

```ts
// Correct
const STREAK_BONUS_THRESHOLD_DAYS = 7;
const STREAK_BONUS_MULTIPLIER = 1.5;
const LONG_STREAK_THRESHOLD_DAYS = 30;
const LONG_STREAK_MULTIPLIER = 2.0;

function calculateMultiplier(streakDays: number): number {
  if (streakDays >= LONG_STREAK_THRESHOLD_DAYS) return LONG_STREAK_MULTIPLIER;
  if (streakDays >= STREAK_BONUS_THRESHOLD_DAYS) return STREAK_BONUS_MULTIPLIER;
  return 1.0;
}

// Wrong — magic numbers
function calculateMultiplier(streakDays: number): number {
  if (streakDays >= 30) return 2.0;
  if (streakDays >= 7) return 1.5;
  return 1.0;
}
```

---

## 7. Template Literals over String Concatenation

```ts
// Correct
const cacheKey = `scheduling-advisor:user:${userId}:stats`;

// Wrong
const cacheKey = 'scheduling-advisor:user:' + userId + ':stats';
```

---

## 8. Import Ordering

Three groups, separated by blank lines, in this order:

1. Node built-ins (`node:path`, `node:fs`)
2. External packages (`react`, `next`, `drizzle-orm`, `zod`)
3. Internal project imports (`@/lib/utils`, `@/db/schema`)

Within each group, order alphabetically.

```ts
// Correct
import { readFileSync } from 'node:fs';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { users } from '@/db/schema';
import { logger } from '@/lib/logger';
```

ESLint's `import/order` rule enforces this automatically — configure it in `eslint.config.mjs`.

---

## 9. JSDoc on Public APIs

All exported functions, classes, interfaces, and React components must have a
JSDoc comment of at least one sentence. Document the *why* or *contract*, not the *what*.

```ts
/** Returns the user's current stats or undefined if the user has never earned points. */
export async function getUserStats(userId: string): Promise<UserStats | undefined> { … }

/** Sidebar navigation item. Active state driven by `isActive` prop, not router state. */
export function SidebarItem({ icon, label, href, isActive }: SidebarItemProps) { … }
```

Do not write multi-paragraph JSDoc blocks. One sentence is the default; two sentences maximum.

---

## 10. No Barrel Re-export Files

Do not create `index.ts` files whose sole purpose is to re-export everything from sibling files.

```ts
// Wrong — barrel that adds no value
// src/server/services/index.ts
export * from './calendar';
export * from './push';
export * from './factory';
```

Exception: the component library's `src/index.ts` is the public API surface — that is
the intended use of a barrel. Barrels inside `src/` subdirectories of an application
(not a library) are the anti-pattern.

---

## 11. String Literal Unions over Enums

Prefer string literal unions unless you need to iterate over values at runtime.

```ts
// Correct — string literal union
type EventType =
  | 'habit_complete'
  | 'goal_milestone'
  | 'goal_complete'
  | 'perfect_day'
  | 'perfect_week';

// Acceptable — enum when you need Object.values() iteration
enum Level {
  Seedling = 'seedling',
  Growing = 'growing',
  Thriving = 'thriving',
  Flourishing = 'flourishing',
  Evergreen = 'evergreen',
}
```

---

## 12. `unknown` over `any`

Never use `any`. Use `unknown` and narrow the type before use.

```ts
// Correct
function parseApiResponse(raw: unknown): UserStats {
  return userStatsSchema.parse(raw); // Zod narrows unknown → UserStats
}

// Wrong
function parseApiResponse(raw: any): UserStats {
  return raw as UserStats;
}
```

---

## 13. Error Handling

Throw only `Error` instances (or subclasses) created with `new`. Never throw strings,
plain objects, or other values — they lose stack traces and break `instanceof` checks.

```ts
// Correct
throw new Error(`User ${userId} not found`);

// Wrong
throw `User ${userId} not found`;
throw { code: 404, message: 'not found' };
```

Treat caught values as `unknown` and narrow before use — anything can be thrown,
so never assume `catch (e)` gives you an `Error`.

```ts
// Correct
try {
  await syncCalendar(userId);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error({ userId, message }, 'calendar sync failed');
}
```

Keep `try` blocks as small as possible — wrap only the statements that can actually
throw, so the `catch` handles one known failure mode instead of a grab-bag.

Empty `catch` blocks require a comment explaining why swallowing the error is correct.

```ts
try {
  localStorage.setItem(key, value);
} catch {
  // Quota exceeded or private browsing — caching is best-effort, app works without it.
}
```

---

## 14. Type Assertions

Type assertions (`as`) bypass the compiler — prefer constructs that are checked:

1. **Runtime validation** (Zod) at system boundaries — already required by CLAUDE.md
2. **Type guards / narrowing** (`instanceof`, `typeof`, `in`, discriminated unions)
3. **Type annotations on literals** — `const x: Foo = {...}` catches typos and missing
   fields; `{...} as Foo` silences them

```ts
// Correct — annotation, compiler verifies the shape
const event: CalendarEvent = { id, start, end, title };

// Wrong — assertion, compiler trusts you blindly
const event = { id, start, end } as CalendarEvent; // missing `title` — no error!
```

When an assertion is genuinely unavoidable:
- Use `as` syntax only — never angle-bracket (`<Foo>value`) assertions
- Comment why the assertion is safe if the reasoning isn't obvious
- For forced double-casts, go through `unknown`: `value as unknown as Foo`

```ts
// Drizzle returns the enum column as string; values are constrained by the
// pgEnum definition, so the assertion cannot be wrong at runtime.
const level = row.level as Level;
```

---

## 15. Named Exports Only

Use named exports everywhere. Default exports produce inconsistent import names,
break grep/rename refactors, and give worse autocomplete.

```ts
// Correct
export function calculateMultiplier(streakDays: number): number { … }

// Wrong
export default function calculateMultiplier(streakDays: number): number { … }
```

**Exception — Next.js framework contracts require default exports:**
`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `template.tsx`,
`default.tsx`, and middleware. Use them there and nowhere else.

Do not export mutable bindings (`export let`). Export a getter function instead.

---

## Prettier Precedence

Prettier owns all formatting rules. When Prettier and the Google style guide conflict on
formatting (semicolons, quote style, indentation, trailing commas, print width),
**Prettier wins**. Never disable Prettier to satisfy a Google style guide formatting rule.

---

## Real-World Examples

Complete examples showing all rules applied together.

### Service interface

```ts
// src/server/services/interfaces/calendar.ts
import type { CalendarEvent } from '@/lib/schemas/calendar'

/** Reads and writes calendar events for a user. */
export interface CalendarService {
  /** Returns all events in [start, end). Never throws — returns [] on error. */
  getEvents(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<ReadonlyArray<CalendarEvent>>

  /** Creates an event and returns the created event's id. */
  createEvent(
    userId: string,
    event: Omit<CalendarEvent, 'id'>,
  ): Promise<string>
}
```

### Zod schema → TypeScript type

```ts
// src/lib/schemas/task.ts
import { z } from 'zod'

export const taskSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  title: z.string().min(1).max(200),
  type: z.enum(['task', 'goal', 'habit']),
  status: z.enum(['pending', 'in_progress', 'completed']),
  targetDate: z.date().optional(),
})

// Derive type from schema — single source of truth
export type Task = z.infer<typeof taskSchema>
```

### Server Action

```ts
// src/server/actions/points.ts
'use server'
import { auth } from '@/auth'
import { db } from '@/db'
import { pointEvents } from '@/db/schema'
import { ratelimit } from '@/lib/redis'

const HABIT_BASE_POINTS = 10

interface AwardPointsResult {
  readonly error?: string
  readonly pointsAwarded?: number
}

/** Awards points for a completed action and updates the user's running stats. */
export async function awardPoints(
  eventType: EventType,
  referenceId?: string,
): Promise<AwardPointsResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized' }

  const { success } = await ratelimit.limit(session.user.id)
  if (!success) return { error: 'Too many requests' }

  const points = POINT_VALUES[eventType]
  await db.insert(pointEvents).values({
    userId: session.user.id,
    eventType,
    points,
    referenceId,
  })

  return { pointsAwarded: points }
}
```

### React component props

```ts
// src/components/ui/sidebar-item/sidebar-item.tsx
import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface SidebarItemProps {
  readonly icon: React.ReactNode
  readonly label: string
  readonly href: string
  readonly isActive?: boolean
  readonly className?: string
}

/** Single navigation item in the app sidebar. Active state driven by `isActive` prop, not router state. */
export function SidebarItem({
  icon,
  label,
  href,
  isActive = false,
  className,
}: SidebarItemProps): React.JSX.Element {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors',
        isActive
          ? 'border-l-2 border-accent bg-accent-subtle text-accent-subtle-foreground'
          : 'text-muted-foreground hover:bg-item-hover hover:text-foreground',
        className,
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  )
}
```
