import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('HTML tags keep attribute quotes balanced', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const malformedTags = [];

  for (const match of html.matchAll(/<[^>]*>/g)) {
    const tag = match[0];
    const doubleQuotes = (tag.match(/"/g) || []).length;
    const singleQuotes = (tag.match(/'/g) || []).length;

    if (doubleQuotes % 2 !== 0 || singleQuotes % 2 !== 0) {
      const line = html.slice(0, match.index).split('\n').length;
      malformedTags.push({ line, tag });
    }
  }

  assert.deepEqual(malformedTags, []);
});
