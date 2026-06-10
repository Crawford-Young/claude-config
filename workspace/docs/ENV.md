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
