import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = [
  new URL('../public/index.html', import.meta.url),
  new URL('../public/app.js', import.meta.url),
  new URL('../public/motoboy.html', import.meta.url),
  new URL('../public/motoboy.js', import.meta.url),
];

test('production UI does not expose demo metrics or fake restaurant names', async () => {
  const content = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');

  for (const forbidden of [
    '942 Motoboys Ativos',
    '12.4K',
    '14 min',
    '16.4 min',
    '99.7%',
    'R$ 84.290,00',
    'R$ 4.203,20',
    '152 / 180',
    '1.842',
    '284',
    '4.92',
    '97.5%',
    'Burger do Chef',
    'Pizzaria Bella Italia',
    'Subway Grill',
    'Cantina di Lucca',
    'Selo Garra Premium',
    'Carlos Oliveira',
    'ABC-1234',
    'Cliente Express',
  ]) {
    assert.doesNotMatch(content, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
