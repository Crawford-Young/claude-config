# Environment Variable Conventions

Standard env vars across all projects. Copy into `.env.example` and document all required vars. `NEXT_PUBLIC_` vars are exposed to the browser — never put secrets there.

```bash
# Database
DATABASE_URL=                         # Neon pooler connection string
MONGODB_URI=                          # MongoDB connection string

# Auth
AUTH_SECRET=                          # openssl rand -base64 32
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

# Payments
STRIPE_SECRET_KEY=                    # sk_live_... or sk_test_...
STRIPE_WEBHOOK_SECRET=                # whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=   # pk_live_... or pk_test_...

# Rate limiting + caching
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Email
RESEND_API_KEY=

# Error monitoring
SENTRY_DSN=
SENTRY_AUTH_TOKEN=

# Real-time
NEXT_PUBLIC_PUSHER_APP_KEY=
NEXT_PUBLIC_PUSHER_CLUSTER=
PUSHER_APP_ID=
PUSHER_SECRET=

# Background jobs
TRIGGER_API_KEY=
TRIGGER_API_URL=

# App
NEXT_PUBLIC_APP_URL=
NODE_ENV=                             # development | production | test
```

## Vercel Env Scoping (earned 2026-06-12)

- **Scope every var to Production + Preview at creation.** Production-only vars make every PR preview build fail at the t3-env Zod gate - the project deploys fine from `main` for months, then the first PR exposes it.
- **Sensitive-type vars cannot be copied client-side.** `vercel env pull` silently writes BLANK values for them (no error), and re-adding from a pull creates empty vars. To change a sensitive var's scope, PATCH its `target` array via the REST API (`PATCH /v9/projects/{id}/env/{envId}` body `{"target":["production","preview"]}`) or edit scope in the dashboard - the value never leaves Vercel.
- Non-interactive `vercel env add NAME preview --value X --yes` can loop on `git_branch_required` - the REST API is the reliable automation path.
- Caveat when copying prod scope to preview: preview deployments then run against the production DB and live Stripe keys. Fine solo; revisit with Neon branch DBs + Stripe test keys when it matters.
- `vercel redeploy <url>` updates the GitHub PR check - no empty commit needed.
