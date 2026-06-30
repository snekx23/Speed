import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const food99ApiUrl = new URL('../supabase/functions/_shared/food99api.ts', import.meta.url);

test('food99 setup falls back to linked stores saved in Supabase when 99Food list is empty', async () => {
  const source = await readFile(food99ApiUrl, 'utf8');

  assert.match(source, /buscarLojasVinculadasDoBanco/);
  assert.match(source, /food99_app_shop_id/);
  assert.match(source, /shops\.length\s*\?\s*shops\s*:\s*await buscarLojasVinculadasDoBanco/);
});
