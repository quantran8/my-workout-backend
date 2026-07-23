# `auth` — business logic

| | |
|---|---|
| **unit** | `src/auth` |
| **kind** | `feature` |
| **status** | `live` |
| **last_updated** | `2026-07-23` |

**Source paths**

- [`auth.controller.ts`](../../../../src/auth/auth.controller.ts) — the five routes
- [`auth.service.ts`](../../../../src/auth/auth.service.ts) — Supabase Auth wrapper
- [`token-verifier.service.ts`](../../../../src/auth/token-verifier.service.ts) — local JWT verification
- [`auth.guard.ts`](../../../../src/auth/auth.guard.ts) — route protection + dev bypass
- [`supabase.strategy.ts`](../../../../src/auth/supabase.strategy.ts) — Passport strategy

---

## 1. Purpose

Wraps Supabase Auth for email/password sign-up and sign-in, and verifies the resulting JWTs on every protected route without a network round-trip.

---

## 2. Flow

```
POST /auth/register → Supabase signUp (anon key)
                    → upsert User row
                    → tokens?  yes → { user, accessToken, refreshToken, … }
                               no  → { user, needsEmailConfirm: true }

POST /auth/login    → Supabase signInWithPassword → upsert User row → session

Any guarded route   → AuthGuard → SupabaseStrategy → TokenVerifier.verify
                      (JWKS cached in-process; no call to Supabase per request)
                    → req.user = AuthUser
```

---

## 3. Business logic

### `AUTH-1` — password operations use the anon key, never the service-role key

- **Trigger** — `signUp`, `signInWithPassword`, `refreshSession`.
- **Effect** — a separate `SupabaseClient` built from `SUPABASE_ANON_KEY`.
- **Why** — the service-role key bypasses Supabase's rate limiting and email-confirmation policy. Using it here would silently disable brute-force protection on login.
- **Edge cases** — `SUPABASE_ANON_KEY` missing throws at module init, deliberately failing fast rather than at first login.
- **Code** — [`auth.service.ts:37`](../../../../src/auth/auth.service.ts#L37) — `onModuleInit`

### `AUTH-2` — every successful auth upserts the app-side `User` row

- **Trigger** — register and login.
- **Effect** — `prisma.user.upsert({ id: <supabase uid> })`.
- **Why** — Supabase owns identity; this app owns training data. The `User` row is created lazily so `auth.uid` is always a valid FK target for profiles, programs and sessions.
- **Code** — [`auth.service.ts:126`](../../../../src/auth/auth.service.ts#L126) — `ensureUserRow`

### `AUTH-3` — login failures are collapsed to one message

- **Trigger** — any failure from `signInWithPassword`.
- **Effect** — `401 Invalid email or password`, regardless of cause.
- **Why** — distinguishing "no such user" from "wrong password" makes the endpoint a user-enumeration oracle.
- **Code** — [`auth.service.ts:80`](../../../../src/auth/auth.service.ts#L80) — `login`

### `AUTH-4` — registration may legitimately return no session

- **Condition** — the Supabase project has "Confirm email" enabled, so `signUp` returns a user with no session.
- **Effect** — responds `{ user, needsEmailConfirm: true }` instead of tokens.
- **Edge cases** — clients must handle both shapes; the mobile app branches on this flag (`AUTH-2` there).
- **Code** — [`auth.service.ts:51`](../../../../src/auth/auth.service.ts#L51) — `register`

### `AUTH-5` — tokens are verified locally against JWKS, not by calling Supabase

- **Trigger** — every guarded request.
- **Effect** — `jose.jwtVerify` against a cached remote JWKS, checking issuer and `audience: 'authenticated'`.
- **Edge cases** — `SUPABASE_JWKS_URL` unset disables verification and every guarded request 401s with "Token verification is not configured" — a loud failure, logged at startup.
- **Why** — a network round-trip per request would put Supabase on the critical path of every API call.
- **Code** — [`token-verifier.service.ts:45`](../../../../src/auth/token-verifier.service.ts#L45) — `verify`

### `AUTH-6` — the dev bypass is env-gated and announces itself

- **Condition** — `AUTH_BYPASS_ENABLED === 'true'`.
- **Effect** — injects a fixed local-dev user and skips verification entirely, logging a warning on every request.
- **Edge cases** — this must never be enabled in a deployed environment; the per-request warning exists so an accidental deploy is noisy rather than silent.
- **Code** — [`auth.guard.ts:16`](../../../../src/auth/auth.guard.ts#L16) — `canActivate`

### `AUTH-7` — sign-out is best-effort

- **Effect** — `POST /auth/logout` revokes the session via a token-scoped client; failures are logged and still return `{ success: true }`.
- **Why** — the client clears local state regardless (mobile `AUTH-6`); returning an error would strand a user who asked to sign out.
- **Code** — [`auth.service.ts:109`](../../../../src/auth/auth.service.ts#L109) — `logout`

---

## 4. State held

Nothing in-process except the cached JWKS. Sessions live in Supabase; `User` rows in Postgres.

---

## 5. Dependencies

- **Services** — Supabase Auth (anon key for password ops, service-role elsewhere); Prisma (`User`).
- **Cross-repo** — [mobile auth memory](../../../../../mobile/.claude/memory/features/auth/auth.md).

---

## 6. Known gotchas

- `SupabaseService` (service-role) and `AuthService`'s anon client are different clients on purpose — see `AUTH-1`.
- `TokenVerifierService` only trusts `payload.sub`; email and metadata are conveniences and may be absent.
- Required env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS_URL`.

---

## 7. Change log

- `2026-07-23` — Claude — initial version: register/login/refresh/logout/me, JWKS verification, dev bypass.
