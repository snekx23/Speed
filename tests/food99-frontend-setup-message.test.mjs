import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appUrl = new URL('../public/app.js', import.meta.url);

test('99Food setup UI shows configuration errors instead of success with zero stores', async () => {
  const source = await readFile(appUrl, 'utf8');

  assert.match(source, /errosSetup99food/);
  assert.match(source, /errosSetup99food\.length/);
  assert.match(source, /statusBadge\.innerText\s*=\s*'Ação necessária'/);
});
