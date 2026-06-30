import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const inserirUrl = new URL('../supabase/functions/_shared/inserir.ts', import.meta.url);
const food99ApiUrl = new URL('../supabase/functions/_shared/food99api.ts', import.meta.url);

test('99Food orders persist the app_shop_id on the linked store record', async () => {
  const source = await readFile(inserirUrl, 'utf8');

  assert.match(source, /tele\.food99_app_shop_id/);
  assert.match(source, /food99_app_shop_id:\s*tele\.food99_app_shop_id/);
});

test('99Food setup explains when the saved store authorization is invalid', async () => {
  const source = await readFile(food99ApiUrl, 'utf8');

  assert.match(source, /10101/);
  assert.match(source, /autorizaç[aã]o da loja no 99Food/i);
});
