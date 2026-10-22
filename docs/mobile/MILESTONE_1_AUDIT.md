# UCC Mobile — Milestone 1 Audit

Date: 2026-10-20 · Branch: `main` · Scope: foundation only (no web changes)

## 1. Repository state on entry

- Git branch `main`, tracking `upstream/main`. Only modified/untracked files at start:
  graphify knowledge-graph artifacts (`graphify-out/*`) — **no user source code was modified**.
  All graphify outputs were left in place, not committed, not reverted.
- No Expo workspace, no React Native app, no `apps/` directory existed before this milestone
  (verified by scanning every `package.json` outside `node_modules`).

## 2. Existing web stack (must keep working)

| Concern     | Choice                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------- |
| Framework   | Next.js 16.3.8 / React 19.3.0, Tailwind v4, deployed via OpenNext on Cloudflare Workers      |
| Supabase    | `@supabase/supabase-js` 2.117.3 + `@supabase/ssr` 0.12.7                                     |
| Package mgmt| npm, `package-lock.json` v3                                                                 |
| Validation  | Not zod — hand-rolled helpers in `lib/validation.ts` + `validateUSN` in `lib/utils.ts`       |

### Environment configuration (keys observed, values not reproduced)

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — client-safe
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME` — server-only (R2 uploads)
- `NEXT_PUBLIC_R2_PUBLIC_DOMAIN` — image CDN host
- `.env` and `.env.local` both exist locally; `.gitignore` covers `.env*` at any depth (no leading slash),
  so nested mobile env files are ignored too.
- **Never ship `service_role` to mobile.** Mobile uses the anon key only; RLS is the security boundary.

## 3. Data model — how `profiles` and `user_profiles` relate to `auth.users`

This is the critical schema risk and it resolves cleanly:

- **`public.profiles` is the canonical table.** `supabase/schema.sql` line 19:
  `id uuid references auth.users on delete cascade primary key` — 1:1 extension of `auth.users`,
  same UUID as the auth user, cascade-deleted.
- Signup provisioning: `public.handle_new_user()` (SECURITY DEFINER trigger on
  `auth.users` insert, line 413–460) inserts the profile row from `raw_user_meta_data`
  (`name`, `usn`, `year`, `department`, `section`, `skills`, `interests`, `intent`,
  with `intent = 'faculty'` mapping to `faculty_status = 'pending'`). Default role `student`.
- **`public.user_profiles` is a LEGACY table.** `schema.sql` lines 66–71: for new installs it does
  not exist; `migrations/2026101302_network_fixes.sql` performs a dynamic-column **one-way sync
  user_profiles → profiles** (`2026101302_network_fixes.sql` line 213, and
  `2026101301_network_and_faculty.sql` line 61). Nothing in app code reads or writes
  `user_profiles` (verified: the only hits in `app/`, `lib/`, `contexts/` are zero).
- **Conclusion: mobile reads/writes `public.profiles` only. The two tables are NOT interchangeable.**

Key columns of `public.profiles`: `id, email, usn (unique), name, year (1–4), branch (default CSE),
section, bio, avatar_url, thumbhash, skills[], interests[], role (student|faculty|admin),
faculty_status (none|pending|verified|rejected), designation, employee_id, expertise[],
created_at, updated_at`.

RLS (schema.sql 819–848): enable on; `select` for everyone (`using (true)`),
`insert`/`update` own (`auth.uid() = id`). With the anon key + a signed-in session the mobile app
can therefore read any profile and read/write **its own** row — no policy changes required.
**No RLS policy was added, altered, or disabled in this milestone.**

## 4. Auth/session behavior the mobile app must preserve

From `contexts/AuthContext.tsx`, `app/signin/page.tsx`, `lib/profile.ts`, `lib/supabase/errors.ts`:

1. **Session bootstrap**: `supabase.auth.getSession()` → on session, fetch profile;
   plus `onAuthStateChange` subscription keeping user/session/profile in sync. Loading flag
   stays true until the first resolution.
2. **Profile load (`fetchProfile`)**:
   a. `select('*').from('profiles').eq('id', authUser.id).maybeSingle()` — **never assumes the row exists**.
   b. Row exists → `normalizeProfile(row)` (defensive coercion: string/number/array/role checks,
      year clamped to 1–4, role defaults `student`, faculty_status defaults `none`).
   c. Row missing → build `fallbackProfileFromAuth` from `auth.users` metadata, attempt
      `insert` (safety net for trigger-less signups; RLS permits insert of own row), then
      re-select; a failed insert surfaces an error rather than pretending success.
   d. Profile created with missing `role` → one 500 ms retry (schema-cache lag tolerance).
3. **Sign-in**: `signInWithPassword({ email, password })` with message mapping:
   - `email not confirmed` → "Your email is not confirmed. Please check your inbox."
   - `invalid login credentials` → "Wrong email or password. Double-check and try again."
4. **Sign-out**: `supabase.auth.signOut()` then clear user/session/profile (mobile adds: clear storage).
5. **Error hygiene**: `logSupabaseError` logs only `message/code/details/hint` — tokens and keys
   are never logged. Mirrored on mobile.
6. Helper predicates worth porting as behavior, not code: `isVerifiedFaculty`, `isAdmin`,
   `canPublishFacultyContent`, `displayName`, `firstName`.

## 5. Domain types / validation shareable with mobile

- **Safe to share (copied for M1, candidates for a shared workspace package in M2):**
  `lib/types.ts` (`Profile`, `UserRole`, `FacultyStatus`, and related domain unions) and
  `lib/profile.ts` (`normalizeProfile`, `fallbackProfileFromAuth`, display/permission helpers).
  These are framework-free TypeScript with no Node/DOM dependency — verified safe for RN.
- **Shareable later, excluded for M1 (web-only transitive deps e.g. `@/lib/utils` tw-merge):**
  `lib/validation.ts` imports `validateUSN` from `lib/utils` (UI-coupled). Mobile re-implements
  the two rules M1 needs (email format, USN format `4UB24CS045`-style) locally in
  `apps/mobile/lib/validation.ts`.
- Everything browser/SSR-specific (`@supabase/ssr` cookie clients in `lib/supabase/{client,server,middleware}.ts`)
  is web-only and is **not** copied; mobile gets its own RN client.

## 6. Supabase client strategy for React Native

- Web clients use `@supabase/ssr` browser/cookie storage — unusable in RN. Mobile uses plain
  `@supabase/supabase-js` (same major version, 2.x) with:
  `auth: { storage: SecureStoreAdapter, autoRefreshToken: true, persistSession: true,
  detectSessionInUrl: false }`.
- **Storage adapter decision (evidence-based):** `expo-secure-store` — Android values live in
  EncryptedSharedPreferences backed by Android Keystore; per current Expo SDK 58 docs Expo itself
  enforces no size limit (the historical ~2048-byte constraint is an iOS Keychain caveat; target
  here is Android). This keeps refresh tokens out of plaintext app-private storage and satisfies
  "securely persisted sessions."
- `react-native-url-polyfill` included per the official Supabase RN guide.
- The anon key is a public client key by design (RLS is the boundary); no service-role key exists
  anywhere in mobile config.

## 7. Monorepo & SDK compatibility decisions

- **Layout**: separate, self-contained Expo app at `apps/mobile` with its own `package.json` and
  `node_modules`. Deliberately **not** wired as an npm workspace in this milestone so the root
  Next.js lockfile, dependency graph, and Cloudflare build remain byte-identical; adopting
  npm workspaces is a recommended Phase-2 refactor with a full web-build regression pass.
- **SDK**: Expo SDK 58 (`expo` 58.x, `react-native` 0.88, `expo-router` 58.x) — current stable
  release line as of Oct 2026, TypeScript-first, New Architecture default. Versions are pinned by
  `npx create-expo-app@latest` + `npx expo install` so package pairings stay consistent.
- Node 24 / npm 11 environment is compatible. JDK 25 present locally is irrelevant to EAS-managed
  builds (EAS builder images use their own JDK); noted for anyone attempting local
  `run:android`.

## 8. Compatibility risks carried forward

1. Supabase `@supabase/ssr` (web) must not be imported by mobile; a `tsconfig` path alias makes the
   boundary explicit.
2. `handle_new_user` trigger + client-side fallback insert (port of `fetchProfile`) can race;
   behavior preserved from web: insert error surfaces, re-select decides the truth.
3. Legacy `user_profiles` may still hold stale rows on this database until backfill completes;
   network features must join against `profiles`, which mobile code does exclusively.
4. `NEXT_PUBLIC_*` env values are compile-time inlined into the mobile bundle — anon key exposure
   is expected and safe; R2 server credentials are never referenced.
5. iOS: the 2KB Keychain caveat is irrelevant for this Android-only milestone but must be revisited
   (e.g. `AsyncStorage` for the user envelope) before an iOS build.
