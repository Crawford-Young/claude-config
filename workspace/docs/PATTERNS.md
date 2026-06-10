# Code Patterns Reference

Copy-paste-ready patterns for every major tool in the stack. Follow these exactly for consistency across all projects. When a pattern here conflicts with a library's docs, prefer this file — it reflects project-specific decisions.

> For scaffolding templates (CI yaml, Justfile, security headers, project structure, Dark Mode standards), see [`docs/TEMPLATES.md`](./TEMPLATES.md)
> For real-world TypeScript style examples, see [`docs/TYPESCRIPT-STYLE.md`](./TYPESCRIPT-STYLE.md)

---

## Contents

- [next-themes — Dark Mode](#next-themes--dark-mode)
- [Lucide React — Icons](#lucide-react--icons)
- [Sonner — Toast Notifications](#sonner--toast-notifications)
- [date-fns — Date Utilities](#date-fns--date-utilities)
- [React Hook Form + Zod — Complex Forms](#react-hook-form--zod--complex-forms)
- [Simple Forms — Server Action + Zod](#simple-forms--server-action--zod)
- [MSW — API Mocking for Tests](#msw--api-mocking-for-tests)
- [Upstash — Rate Limiting & Caching](#upstash--rate-limiting--caching)
- [Stripe — Payments](#stripe--payments)
- [t3-env — Environment Variables](#t3-env--environment-variables)
- [Zod — Schema Patterns](#zod--schema-patterns)
- [Pino — Logger](#pino--logger)
- [Server Actions — Standard Pattern](#server-actions--standard-pattern)
- [TanStack Query — Patterns](#tanstack-query--patterns)
- [Drizzle ORM — Neon Patterns](#drizzle-orm--neon-patterns)
- [MongoDB — Native Driver Patterns](#mongodb--native-driver-patterns)
- [Auth.js v5 — Patterns](#authjs-v5--patterns)
- [Zustand — Store Pattern](#zustand--store-pattern)
- [Pusher Channels — Patterns](#pusher-channels--patterns)
- [Trigger.dev v3 — Job Patterns](#triggerdev-v3--job-patterns)
- [Resend + React Email — Patterns](#resend--react-email--patterns)
- [Sentry — Setup Pattern](#sentry--setup-pattern)
- [React Server Component — Data Fetching Pattern](#react-server-component--data-fetching-pattern)
- [API Route — External Endpoint Pattern](#api-route--external-endpoint-pattern)
- [Animations — prefers-reduced-motion](#animations--prefers-reduced-motion)

---
## next-themes — Dark Mode

```tsx
// src/app/layout.tsx
import { ThemeProvider } from 'next-themes'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
```

```ts
// tailwind.config.ts
export default {
  darkMode: 'class',
  // ...
}
```

Theme toggle hook:
```ts
// src/hooks/use-theme.ts — thin re-export for consistent import path
export { useTheme } from 'next-themes'
```

---

## Lucide React — Icons

```tsx
import { Settings, ChevronRight, Loader2 } from 'lucide-react'

// Always set explicit size and aria-hidden for decorative icons
<Settings className="h-4 w-4" aria-hidden="true" />

// For meaningful icons (no visible label), add aria-label to the parent button
<button aria-label="Open settings">
  <Settings className="h-4 w-4" aria-hidden="true" />
</button>

// Loading spinner pattern
<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
```

---

## Sonner — Toast Notifications

```tsx
// src/app/layout.tsx — add Toaster to root layout
import { Toaster } from 'sonner'

// Inside layout body:
<Toaster position="bottom-right" theme="dark" richColors />
```

Usage:
```ts
import { toast } from 'sonner'

// Success
toast.success('Profile updated')

// Error
toast.error('Something went wrong', { description: err.message })

// Promise (automatically shows loading â†’ success/error)
toast.promise(saveUser(data), {
  loading: 'Saving...',
  success: 'Saved!',
  error: 'Failed to save',
})
```

---

## date-fns — Date Utilities

```ts
import { format, formatDistanceToNow, isAfter, parseISO } from 'date-fns'

// Format for display
format(date, 'MMM d, yyyy')           // "Jan 1, 2025"
format(date, 'h:mm a')               // "3:45 PM"

// Relative time
formatDistanceToNow(date, { addSuffix: true })  // "3 hours ago"

// Comparison
isAfter(new Date(), expiresAt)

// Parse ISO string from API/DB
parseISO('2025-01-01T00:00:00Z')
```

Never use `new Date(string)` for parsing — use `parseISO` for ISO strings.

---

## React Hook Form + Zod — Complex Forms

```tsx
// src/components/profile-form.tsx
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { updateProfileAction } from '@/server/actions/profile'

const ProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  bio: z.string().max(500).optional(),
})

type ProfileFormData = z.infer<typeof ProfileSchema>

export function ProfileForm({ defaultValues }: { defaultValues: ProfileFormData }) {
  const [isPending, startTransition] = useTransition()

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(ProfileSchema),
    defaultValues,
  })

  function onSubmit(data: ProfileFormData) {
    startTransition(async () => {
      const result = await updateProfileAction(data)
      if (result.error) {
        toast.error('Failed to update profile', { description: result.error })
      } else {
        toast.success('Profile updated')
      }
    })
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <div>
        <label htmlFor="name">Name</label>
        <input id="name" {...form.register('name')} />
        {form.formState.errors.name && (
          <p role="alert">{form.formState.errors.name.message}</p>
        )}
      </div>
      <button type="submit" disabled={isPending}>
        {isPending ? 'Savingâ€¦' : 'Save'}
      </button>
    </form>
  )
}
```

---

## MSW — API Mocking for Tests

```ts
// tests/mocks/handlers.ts
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/api/users', () => {
    return HttpResponse.json([
      { id: '1', name: 'Alice', email: 'alice@example.com' },
    ])
  }),

  http.post('/api/users', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: '2', ...body }, { status: 201 })
  }),
]
```

```ts
// tests/mocks/server.ts
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
```

```ts
// tests/setup.ts (referenced in vitest.config.ts)
import '@testing-library/jest-dom/vitest'   // extends expect with .toBeInTheDocument() etc.
import { beforeAll, afterAll, afterEach } from 'vitest'
import { server } from './mocks/server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'happy-dom',   // faster than jsdom; same API
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
})
```

Override a handler for a specific test:
```ts
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'

it('handles 500 error', async () => {
  server.use(
    http.get('/api/users', () => HttpResponse.json({ error: 'Server error' }, { status: 500 }))
  )
  // ... test the error state
})
```

---

## Upstash — Rate Limiting & Caching

```ts
// src/lib/redis.ts
import { Redis } from '@upstash/redis'
import { env } from '@/env'

export const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
})
```

### Rate limiting
```ts
// src/lib/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit'
import { redis } from './redis'

// 10 requests per 10 seconds per identifier
export const rateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '10 s'),
  analytics: true,
})
```

Apply in a Server Action:
```ts
import { rateLimiter } from '@/lib/rate-limit'
import { auth } from '@/lib/auth'

export async function sensitiveAction(input: unknown) {
  const session = await auth()
  const identifier = session?.user?.id ?? 'anonymous'

  const { success } = await rateLimiter.limit(identifier)
  if (!success) return { error: 'Too many requests. Please slow down.' }

  // ... rest of action
}
```

### Caching
```ts
// Cache pattern — key: [project]:[resource]:[id]
const CACHE_TTL = 60 * 5 // 5 minutes

export async function getCachedUser(id: string) {
  const cacheKey = `myapp:user:${id}`

  const cached = await redis.get<User>(cacheKey)
  if (cached) return cached

  const user = await userService.findById(id)
  if (user) await redis.set(cacheKey, user, { ex: CACHE_TTL })

  return user
}

// Invalidate on mutation
export async function updateUser(id: string, input: UpdateUserInput) {
  const user = await userService.update(id, input)
  await redis.del(`myapp:user:${id}`)
  return user
}
```

---

## Stripe — Payments

```ts
// src/lib/stripe.ts
import Stripe from 'stripe'
import { env } from '@/env'

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
  typescript: true,
})
```

### Checkout session (server action)
```ts
// src/server/actions/checkout.ts
'use server'

import { auth } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { env } from '@/env'
import { redirect } from 'next/navigation'

export async function createCheckoutSession(priceId: string) {
  const session = await auth()
  if (!session?.user) return { error: 'Unauthorized' }

  const checkout = await stripe.checkout.sessions.create({
    customer_email: session.user.email!,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.NEXT_PUBLIC_APP_URL}/dashboard?checkout=success`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/pricing`,
    metadata: { userId: session.user.id },
  })

  redirect(checkout.url!)
}
```

### Webhook handler
```ts
// src/app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { env } from '@/env'
import { logger } from '@/lib/logger'
import * as Sentry from '@sentry/nextjs'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  logger.info({ type: event.type }, 'Stripe webhook received')

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      // provision access...
      break
    }
    case 'customer.subscription.deleted': {
      // revoke access...
      break
    }
  }

  return NextResponse.json({ received: true })
}
```

---

## t3-env — Environment Variables

```ts
// src/env.ts
import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    AUTH_SECRET: z.string().min(32),
    RESEND_API_KEY: z.string().startsWith('re_'),
    SENTRY_DSN: z.string().url().optional(),
    PUSHER_APP_ID: z.string(),
    PUSHER_SECRET: z.string(),
    TRIGGER_API_KEY: z.string(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
    NEXT_PUBLIC_PUSHER_APP_KEY: z.string(),
    NEXT_PUBLIC_PUSHER_CLUSTER: z.string(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    SENTRY_DSN: process.env.SENTRY_DSN,
    PUSHER_APP_ID: process.env.PUSHER_APP_ID,
    PUSHER_SECRET: process.env.PUSHER_SECRET,
    TRIGGER_API_KEY: process.env.TRIGGER_API_KEY,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_PUSHER_APP_KEY: process.env.NEXT_PUBLIC_PUSHER_APP_KEY,
    NEXT_PUBLIC_PUSHER_CLUSTER: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
  },
})
```

---

## Zod — Schema Patterns

```ts
// src/lib/schemas/user.ts
import { z } from 'zod'

export const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'member']).default('member'),
})

export const UpdateUserSchema = CreateUserSchema.partial().omit({ email: true })

export type CreateUserInput = z.infer<typeof CreateUserSchema>
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>
```

---

## Pino — Logger

```ts
// src/lib/logger.ts
import pino from 'pino'
import { env } from '@/env'

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  ...(env.NODE_ENV !== 'production' && {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  }),
})
```

Usage:
```ts
import { logger } from '@/lib/logger'

logger.info({ userId: '123', action: 'login' }, 'User logged in')
logger.error({ err, userId }, 'Failed to process payment')
```

---

## Server Actions — Standard Pattern

```ts
// src/server/actions/user.ts
'use server'

import { z } from 'zod'
import { auth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { CreateUserSchema } from '@/lib/schemas/user'
import { userService } from '@/server/services/user'

export async function createUserAction(input: unknown) {
  const session = await auth()
  if (!session?.user) return { error: 'Unauthorized' }

  const parsed = CreateUserSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.flatten() }

  try {
    const user = await userService.create(parsed.data)
    return { data: user }
  } catch (err) {
    logger.error({ err }, 'Failed to create user')
    return { error: 'Something went wrong' }
  }
}
```

Return shape is always `{ data } | { error }` — never throw from a Server Action.

---

## TanStack Query — Patterns

### Query (client-side fetch)
```ts
// src/hooks/use-users.ts
'use client'

import { useQuery } from '@tanstack/react-query'

async function fetchUsers(): Promise<User[]> {
  const res = await fetch('/api/users')
  if (!res.ok) throw new Error('Failed to fetch users')
  return res.json()
}

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: fetchUsers })
}
```

### Mutation (with Server Action)
```ts
// src/hooks/use-create-user.ts
'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createUserAction } from '@/server/actions/user'
import type { CreateUserInput } from '@/lib/schemas/user'

export function useCreateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateUserInput) => createUserAction(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}
```

### Optimistic Update
```ts
useMutation({
  mutationFn: updateUser,
  onMutate: async (newUser) => {
    await queryClient.cancelQueries({ queryKey: ['users', newUser.id] })
    const previous = queryClient.getQueryData(['users', newUser.id])
    queryClient.setQueryData(['users', newUser.id], newUser)
    return { previous }
  },
  onError: (_err, _newUser, context) => {
    queryClient.setQueryData(['users', context?.previous?.id], context?.previous)
  },
  onSettled: (data) => {
    queryClient.invalidateQueries({ queryKey: ['users', data?.id] })
  },
})
```

---

## Drizzle ORM — Neon Patterns

### Client setup (serverless-safe)
```ts
// src/db/index.ts
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { env } from '@/env'
import * as schema from './schema'

const sql = neon(env.DATABASE_URL)
export const db = drizzle(sql, { schema })
```

### Schema
```ts
// src/db/schema.ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})
```

### Queries
```ts
// src/server/queries/user.ts
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'

export async function getUserById(id: string) {
  return db.query.users.findFirst({ where: eq(users.id, id) })
}

export async function listUsers() {
  return db.select().from(users).orderBy(users.createdAt)
}
```

### Service (business logic layer)
```ts
// src/server/services/user.ts
import { db } from '@/db'
import { users } from '@/db/schema'
import type { CreateUserInput } from '@/lib/schemas/user'

export const userService = {
  async create(input: CreateUserInput) {
    const [user] = await db.insert(users).values(input).returning()
    return user
  },
  async update(id: string, input: Partial<CreateUserInput>) {
    const [user] = await db.update(users).set(input).where(eq(users.id, id)).returning()
    return user
  },
  async delete(id: string) {
    await db.delete(users).where(eq(users.id, id))
  },
}
```

---

## MongoDB — Native Driver Patterns

### Client setup
```ts
// src/db/index.ts
import { MongoClient } from 'mongodb'
import { env } from '@/env'

declare global {
  var _mongoClient: MongoClient | undefined
}

const client = global._mongoClient ?? new MongoClient(env.MONGODB_URI)
if (process.env.NODE_ENV !== 'production') global._mongoClient = client

export const db = client.db()
```

### Collection schema + typed helper
```ts
// src/db/schemas/user.ts
import { z } from 'zod'
import { ObjectId } from 'mongodb'

export const UserSchema = z.object({
  _id: z.instanceof(ObjectId).optional(),
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['admin', 'member']).default('member'),
  createdAt: z.date().default(() => new Date()),
})

export type User = z.infer<typeof UserSchema>
```

### Service
```ts
// src/server/services/user.ts
import { ObjectId } from 'mongodb'
import { db } from '@/db'
import { UserSchema, type User } from '@/db/schemas/user'

const collection = () => db.collection<User>('users')

export const userService = {
  async create(input: unknown): Promise<User> {
    const data = UserSchema.parse(input)
    const result = await collection().insertOne(data)
    return { ...data, _id: result.insertedId }
  },
  async findById(id: string): Promise<User | null> {
    return collection().findOne({ _id: new ObjectId(id) })
  },
  async list(): Promise<User[]> {
    return collection().find().sort({ createdAt: -1 }).toArray()
  },
}
```

### Index definitions
```ts
// src/db/indexes.ts
import { db } from '@/db'

export async function ensureIndexes() {
  await db.collection('users').createIndexes([
    { key: { email: 1 }, unique: true },
    { key: { createdAt: -1 } },
  ])
}
```

---

## Auth.js v5 — Patterns

### Config
```ts
// src/lib/auth.ts
import NextAuth from 'next-auth'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import Google from 'next-auth/providers/google'
import { db } from '@/db'
import { env } from '@/env'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  providers: [Google],
  session: { strategy: 'database' },
  secret: env.AUTH_SECRET,
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id
      return session
    },
  },
})
```

### Route handler
```ts
// src/app/api/auth/[...nextauth]/route.ts
export { handlers as GET, handlers as POST } from '@/lib/auth'
```

### Middleware (route protection)
```ts
// middleware.ts
import { auth } from '@/lib/auth'

export default auth((req) => {
  if (!req.auth && req.nextUrl.pathname.startsWith('/dashboard')) {
    return Response.redirect(new URL('/login', req.url))
  }
})

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] }
```

### Session in Server Component
```ts
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect('/login')

  return <div>Welcome {session.user.name}</div>
}
```

---

## Zustand — Store Pattern

```ts
// src/lib/stores/ui-store.ts
import { create } from 'zustand'

interface UIStore {
  isSidebarOpen: boolean
  activeModal: string | null
  openModal: (id: string) => void
  closeModal: () => void
  toggleSidebar: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  isSidebarOpen: true,
  activeModal: null,
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),
}))
```

---

## Pusher Channels — Patterns

### Server-side trigger (from Server Action or API Route)
```ts
// src/lib/pusher-server.ts
import Pusher from 'pusher'
import { env } from '@/env'

export const pusherServer = new Pusher({
  appId: env.PUSHER_APP_ID,
  key: env.NEXT_PUBLIC_PUSHER_APP_KEY,
  secret: env.PUSHER_SECRET,
  cluster: env.NEXT_PUBLIC_PUSHER_CLUSTER,
  useTLS: true,
})
```

```ts
// usage in a Server Action
await pusherServer.trigger(`private-room-${roomId}`, 'message:new', { message })
```

### Auth endpoint (required for private channels)
```ts
// src/app/api/pusher/auth/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pusherServer } from '@/lib/pusher-server'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.text()
  const params = new URLSearchParams(body)
  const socketId = params.get('socket_id')!
  const channel = params.get('channel_name')!

  const authResponse = pusherServer.authorizeChannel(socketId, channel)
  return NextResponse.json(authResponse)
}
```

### Client-side subscription hook
```ts
// src/hooks/use-pusher-channel.ts
'use client'

import { useEffect } from 'react'
import Pusher from 'pusher-js'
import { env } from '@/env'

const pusherClient = new Pusher(env.NEXT_PUBLIC_PUSHER_APP_KEY, {
  cluster: env.NEXT_PUBLIC_PUSHER_CLUSTER,
  authEndpoint: '/api/pusher/auth',
})

export function usePusherChannel<T>(
  channel: string,
  event: string,
  handler: (data: T) => void,
) {
  useEffect(() => {
    const ch = pusherClient.subscribe(channel)
    ch.bind(event, handler)
    return () => {
      ch.unbind(event, handler)
      pusherClient.unsubscribe(channel)
    }
  }, [channel, event, handler])
}
```

---

## Trigger.dev v3 — Job Patterns

### Job definition
```ts
// src/trigger/email-jobs.ts
import { task } from '@trigger.dev/sdk/v3'
import { z } from 'zod'
import { emailService } from '@/server/services/email'

const SendWelcomeEmailPayload = z.object({
  userId: z.string(),
  email: z.string().email(),
  name: z.string(),
})

export const sendWelcomeEmail = task({
  id: 'send-welcome-email',
  run: async (payload: z.infer<typeof SendWelcomeEmailPayload>) => {
    const validated = SendWelcomeEmailPayload.parse(payload)
    await emailService.sendWelcome(validated)
    return { success: true }
  },
})
```

### Trigger from Server Action
```ts
import { sendWelcomeEmail } from '@/trigger/email-jobs'

await sendWelcomeEmail.trigger({ userId, email, name })
```

---

## Resend + React Email — Patterns

### Email template
```tsx
// src/emails/welcome.tsx
import { Html, Head, Body, Container, Text, Button } from '@react-email/components'

interface WelcomeEmailProps {
  name: string
  loginUrl: string
}

export function WelcomeEmail({ name, loginUrl }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Body>
        <Container>
          <Text>Hi {name}, welcome aboard!</Text>
          <Button href={loginUrl}>Get started</Button>
        </Container>
      </Body>
    </Html>
  )
}
```

### Email service
```ts
// src/server/services/email.ts
import { Resend } from 'resend'
import { render } from '@react-email/render'
import { env } from '@/env'
import { WelcomeEmail } from '@/emails/welcome'
import { logger } from '@/lib/logger'

const resend = new Resend(env.RESEND_API_KEY)

export const emailService = {
  async sendWelcome({ email, name }: { email: string; name: string }) {
    try {
      await resend.emails.send({
        from: 'noreply@yourdomain.com',
        to: email,
        subject: 'Welcome!',
        html: await render(<WelcomeEmail name={name} loginUrl={`${env.NEXT_PUBLIC_APP_URL}/login`} />),
      })
    } catch (err) {
      logger.error({ err, email }, 'Failed to send welcome email')
      throw err
    }
  },
}
```

---

## Sentry — Setup Pattern

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { init } = await import('@sentry/nextjs')
    init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      environment: process.env.NODE_ENV,
    })
  }
}
```

Usage in try/catch:
```ts
import * as Sentry from '@sentry/nextjs'

try {
  await riskyOperation()
} catch (err) {
  Sentry.captureException(err, { extra: { userId } })
  logger.error({ err }, 'Risky operation failed')
  throw err
}
```

---

## React Server Component — Data Fetching Pattern

```tsx
// src/app/dashboard/page.tsx
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { userService } from '@/server/services/user'
import { UserList } from './user-list'

// No 'use client' — this is a Server Component
export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const users = await userService.list()

  return (
    <main>
      <h1>Dashboard</h1>
      <UserList users={users} />
    </main>
  )
}
```

---

## API Route — External Endpoint Pattern

Only use API Routes for endpoints consumed outside this Next.js app.

```ts
// src/app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const StripeEventSchema = z.object({
  type: z.string(),
  data: z.object({ object: z.unknown() }),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = StripeEventSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  logger.info({ eventType: parsed.data.type }, 'Stripe webhook received')

  // handle event...

  return NextResponse.json({ received: true })
}
```


---

## Animations — prefers-reduced-motion

### Tailwind (preferred — zero JS cost)
```tsx
// Decorative hover scale
<div className="motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:scale-105">
  content
</div>

// Entrance animation
<div className="motion-safe:animate-fade-in motion-reduce:opacity-100">
  content
</div>
```

### Framer Motion (opt-in — only when Tailwind can't do it)
```tsx
'use client'

import { motion, useReducedMotion } from 'framer-motion'

export function AnimatedCard({ children }: { children: React.ReactNode }) {
  const prefersReduced = useReducedMotion()

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReduced ? 0 : 0.3 }}
    >
      {children}
    </motion.div>
  )
}
```

### React Bits (portfolio projects only)
```tsx
// Always dynamic import — never bundle into main chunk
import dynamic from 'next/dynamic'

const Particles = dynamic(
  () => import('reactbits/Particles'),
  { ssr: false, loading: () => null }
)

// Always gate on prefers-reduced-motion
export function HeroBackground() {
  const prefersReduced = useReducedMotion()
  if (prefersReduced) return null
  return <Particles />
}
```

---

## Simple Forms — Server Action + Zod

For single-step forms with no complex client validation UX:

```ts
// src/lib/schemas/contact.ts
import { z } from 'zod'

export const ContactSchema = z.object({
  email: z.string().email(),
  message: z.string().min(10).max(1000),
})
```

```ts
// src/server/actions/contact.ts
'use server'

import { ContactSchema } from '@/lib/schemas/contact'

export async function submitContact(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string }> {
  const result = ContactSchema.safeParse(Object.fromEntries(formData))
  if (!result.success) return { error: result.error.issues[0].message }

  // ... persist / send
  return {}
}
```

```tsx
// src/components/contact/contact-form.tsx
'use client'

import { useActionState } from 'react'
import { submitContact } from '@/server/actions/contact'

export function ContactForm(): React.JSX.Element {
  const [state, action, pending] = useActionState(submitContact, undefined)

  return (
    <form action={action}>
      <input name="email" type="email" required />
      <textarea name="message" required />
      {state?.error && <p>{state.error}</p>}
      <button type="submit" disabled={pending}>Send</button>
    </form>
  )
}
```
