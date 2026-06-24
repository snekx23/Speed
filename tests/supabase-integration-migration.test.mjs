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
  assert.doesNotMatch(
    sql,
    /insert\s+into\s+public\.(fleet|client_history|pending_deliveries|support_messages)/,
  );
});
