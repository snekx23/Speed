# Supabase Integrations Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the iFood and 99Food backend from Supabase project `evupemncvectyyeoeajz` to `faowxiyxjfogkoynsohj` without overwriting the operational data already present in the destination.

**Architecture:** Add a small, idempotent integration-only migration instead of replaying the old full schema. Copy integration rows and custom secrets through authenticated Supabase APIs, deploy the seven existing Edge Functions, then cut the frontend and the 99Food webhook over only after backend verification succeeds.

**Tech Stack:** PostgreSQL, Supabase Management API, Supabase Edge Functions/Deno, PowerShell, Node.js built-in test runner, vanilla JavaScript, Cloudflare Workers.

---

## File map

- Create `supabase/migrations/0007_integration_target.sql`: destination-safe schema for iFood/99Food only.
- Create `tests/supabase-integration-migration.test.mjs`: static regression checks for the targeted SQL and project references.
- Modify `public/app.js`: destination Supabase URL and anon key.
- Modify `public/motoboy.js`: destination Supabase URL and anon key.
- Modify `README.md`: destination project reference.
- Modify `supabase/README.md`: destination deployment commands and webhook endpoint.

### Task 1: Add the destination-safe integration migration

**Files:**
- Create: `supabase/migrations/0007_integration_target.sql`
- Create: `tests/supabase-integration-migration.test.mjs`

- [ ] **Step 1: Write the failing migration test**

Create a Node test that reads `0007_integration_target.sql` and asserts that it creates `lojas`, `ifood_tokens`, `food99_tokens`, and `webhook_logs`, adds `pending_deliveries.bidding_started_at`, and contains no destructive `drop table`, `truncate`, or writes to operational tables.

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/0007_integration_target.sql', import.meta.url);

test('target migration installs only the integration schema', async () => {
  const sql = (await readFile(migrationUrl, 'utf8')).toLowerCase();
  for (const table of ['lojas', 'ifood_tokens', 'food99_tokens', 'webhook_logs']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(sql, /alter table public\.pending_deliveries[\s\S]*bidding_started_at/);
  assert.doesNotMatch(sql, /drop\s+table|truncate\s+table/);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.(fleet|client_history|pending_deliveries|support_messages)/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test tests/supabase-integration-migration.test.mjs
```

Expected: FAIL because `0007_integration_target.sql` does not exist.

- [ ] **Step 3: Write the idempotent SQL migration**

Create the migration with this complete SQL:

```sql
create extension if not exists "pgcrypto";

create table if not exists public.lojas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ifood_merchant_id text unique,
  ifood_merchant_nome text,
  status text not null default 'desconectada'
    check (status in ('desconectada', 'conectando', 'conectada')),
  pickup_lat double precision,
  pickup_lng double precision,
  created_at timestamptz not null default now(),
  taxa_entrega_padrao numeric(10, 2) not null default 0,
  taxa_motoboy_padrao numeric(10, 2) not null default 0
);

create table if not exists public.ifood_tokens (
  loja_id uuid primary key references public.lojas (id) on delete cascade,
  access_token text,
  refresh_token text,
  token_expira_em timestamptz,
  authorization_code_verifier text,
  user_code text,
  user_code_expira_em timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.food99_tokens (
  app_shop_id text primary key,
  auth_token text,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.webhook_logs (
  id uuid primary key default gen_random_uuid(),
  origem text,
  payload jsonb,
  headers jsonb,
  raw text,
  created_at timestamptz not null default now()
);

alter table public.pending_deliveries
  add column if not exists bidding_started_at timestamptz;

alter table public.lojas enable row level security;
alter table public.ifood_tokens enable row level security;
alter table public.food99_tokens enable row level security;
alter table public.webhook_logs enable row level security;

drop policy if exists lojas_all on public.lojas;
create policy lojas_all on public.lojas
  for all using (true) with check (true);
```

- [ ] **Step 4: Run the focused and existing tests**

Run:

```powershell
node --test tests/supabase-integration-migration.test.mjs tests/html-structure.test.mjs
git diff --check
```

Expected: both tests PASS and `git diff --check` exits 0.

- [ ] **Step 5: Commit the migration**

```powershell
git add supabase/migrations/0007_integration_target.sql tests/supabase-integration-migration.test.mjs
git commit -m "feat: add targeted Supabase integration schema"
```

### Task 2: Apply schema and copy integration state

**Files:**
- Read: `supabase/migrations/0007_integration_target.sql`
- No credential file is created.

- [ ] **Step 1: Export a pre-write inventory in memory**

Use the Supabase Management API with `SUPABASE_ACCESS_TOKEN` to record table names, columns, and row counts for both projects. Do not print secret values or service-role keys.

- [ ] **Step 2: Apply the migration to the destination**

POST the complete SQL file to:

```text
https://api.supabase.com/v1/projects/faowxiyxjfogkoynsohj/database/query
```

Expected: HTTP 201/200 and no PostgreSQL error.

- [ ] **Step 3: Copy integration rows using PostgREST service-role requests**

Retrieve service-role keys from each project's Management API without printing them. Read and upsert, in dependency order:

1. `lojas`;
2. `ifood_tokens`;
3. `food99_tokens`;
4. `webhook_logs`.

Use `Prefer: resolution=merge-duplicates,return=minimal` and `on_conflict` matching each primary key. Existing destination operational tables are not included.

- [ ] **Step 4: Verify schema and copied counts**

Query the destination and confirm:

- 2 `lojas` rows;
- 0 `ifood_tokens` rows, matching the source snapshot;
- 0 `food99_tokens` rows, matching the source snapshot;
- source `webhook_logs` rows are present;
- `pending_deliveries` retains its prior row count;
- `fleet`, `client_history`, and `support_messages` retain their prior row counts.

### Task 3: Copy secrets and deploy Edge Functions

**Files:**
- Read: `supabase/functions/**`
- No secret value is written locally.

- [ ] **Step 1: Copy only custom secrets**

Read secret objects from the source Management API and POST only these names to the destination:

```text
FOOD99_APP_ID
FOOD99_APP_SHOP_ID
FOOD99_SECRET
WEBHOOK_99FOOD_TOKEN
IFOOD_CLIENT_ID
IFOOD_CLIENT_SECRET
```

Do not copy any `SUPABASE_*` secret because the destination automatically provides project-specific values.

- [ ] **Step 2: Install/use the current Supabase CLI without persisting credentials**

Run:

```powershell
npx supabase@latest --version
```

Expected: a current CLI version and exit code 0.

- [ ] **Step 3: Deploy the 99Food functions**

Run with `SUPABASE_ACCESS_TOKEN` set only in the current process:

```powershell
npx supabase@latest functions deploy food99-webhook --project-ref faowxiyxjfogkoynsohj --no-verify-jwt
npx supabase@latest functions deploy food99-vincular --project-ref faowxiyxjfogkoynsohj
npx supabase@latest functions deploy food99-setup --project-ref faowxiyxjfogkoynsohj
npx supabase@latest functions deploy food99-pedido --project-ref faowxiyxjfogkoynsohj
```

- [ ] **Step 4: Deploy the iFood functions**

```powershell
npx supabase@latest functions deploy ifood-conectar --project-ref faowxiyxjfogkoynsohj
npx supabase@latest functions deploy ifood-pedido --project-ref faowxiyxjfogkoynsohj
npx supabase@latest functions deploy ifood-polling --project-ref faowxiyxjfogkoynsohj
```

- [ ] **Step 5: Verify backend inventory**

Confirm through the Management API that all seven slugs are `ACTIVE` and all six custom secret names exist. Output names and statuses only.

### Task 4: Repoint the frontend to the destination project

**Files:**
- Modify: `public/app.js:3-5`
- Modify: `public/motoboy.js:3-4`
- Modify: `README.md:93-98`
- Modify: `supabase/README.md:9-47`
- Modify: `tests/supabase-integration-migration.test.mjs`

- [ ] **Step 1: Extend the test and verify RED**

Add this test to `tests/supabase-integration-migration.test.mjs`:

```js
test('application and deployment docs target garradelivery Supabase', async () => {
  const files = [
    '../public/app.js',
    '../public/motoboy.js',
    '../README.md',
    '../supabase/README.md',
  ];
  for (const relativePath of files) {
    const content = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(content, /faowxiyxjfogkoynsohj/);
    assert.doesNotMatch(content, /evupemncvectyyeoeajz/);
  }
});
```

Run:

```powershell
node --test tests/supabase-integration-migration.test.mjs
```

Expected: FAIL because the files still reference the source project.

- [ ] **Step 2: Retrieve the destination anon key without logging it**

Read `/v1/projects/faowxiyxjfogkoynsohj/api-keys`, select the `anon` key, and hold it only in memory while editing the two public JavaScript files. The anon key is a browser-publishable credential, but it must not be printed unnecessarily.

- [ ] **Step 3: Update project references**

Replace the source URL/key in `public/app.js` and `public/motoboy.js`. Replace source project refs and webhook examples in both README files.

- [ ] **Step 4: Verify GREEN**

```powershell
node --test tests/supabase-integration-migration.test.mjs tests/html-structure.test.mjs
git diff --check
```

Expected: all tests PASS.

- [ ] **Step 5: Commit frontend cutover**

```powershell
git add public/app.js public/motoboy.js README.md supabase/README.md tests/supabase-integration-migration.test.mjs
git commit -m "feat: move integrations to garradelivery Supabase"
```

### Task 5: Verify the new backend before changing the external webhook

**Files:**
- No repository changes.

- [ ] **Step 1: Test the 99Food webhook health endpoint**

GET:

```text
https://faowxiyxjfogkoynsohj.supabase.co/functions/v1/food99-webhook
```

Expected JSON: `{ "errno": 0, "errmsg": "ok" }`.

- [ ] **Step 2: Send a controlled authenticated webhook payload**

Use the existing webhook token in the query string without printing it. Send a synthetic `orderNew` payload with a unique test ID, confirm HTTP success, confirm one new `webhook_logs` row and one new `pending_deliveries` row, then delete both test rows.

- [ ] **Step 3: Validate function error handling without consuming iFood events**

Do not invoke live iFood polling during pre-cutover. Confirm the function is active and its required secret names exist. The first live polling invocation is part of the controlled cutover because it acknowledges iFood events.

### Task 6: Publish and verify the frontend

**Files:**
- No additional repository changes.

- [ ] **Step 1: Push `main`**

```powershell
git push origin main
```

- [ ] **Step 2: Wait for the connected production deployment**

Poll `https://garradelivery.guigui-couto23.workers.dev/app.js` until it contains the destination project ref.

- [ ] **Step 3: Browser verification**

Log in as admin and partner, open Integrations, Fleet, Support, Settings, and the motoboy app. Confirm requests go to `faowxiyxjfogkoynsohj` and no console errors are produced.

### Task 7: Cut over the 99Food portal webhook

**Files:**
- No repository changes.

- [ ] **Step 1: Open the existing 99Food application settings**

Use the user's authenticated browser session and navigate to the application shown in the supplied screenshot. Do not reveal the app secret or webhook token.

- [ ] **Step 2: Replace only the webhook host/project ref**

Read `WEBHOOK_99FOOD_TOKEN` from the source secret object into an in-memory variable named `existingWebhookToken`. Change the webhook URL from the source function URL to the destination function URL and append `?token=` plus that unchanged in-memory value:

```text
https://faowxiyxjfogkoynsohj.supabase.co/functions/v1/food99-webhook
```

Keep the existing query token unchanged.

- [ ] **Step 3: Save and verify the portal value**

Confirm the portal displays the destination project ref in the saved webhook URL.

- [ ] **Step 4: Final end-to-end evidence**

Repeat webhook health verification, confirm new callback logs arrive only in the destination, and report the exact state of schema, data, secrets, functions, frontend production, and portal cutover.
