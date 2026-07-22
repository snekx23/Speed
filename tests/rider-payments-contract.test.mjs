import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const shared = readFileSync(new URL('../public/financial-calculations.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(shared, context);
const calculate = context.window.GarraFinancial.calculateWeeklyRiderPayment;

test('repasse segue bruto menos taxa das corridas, consumíveis e créditos líquidos', () => {
  assert.deepEqual({ ...calculate(0, 100, 12) }, {
    grossAmount: 0, creditsAmount: 100, consumablesAmount: 12,
    garraFee: 0, deliveryNet: 0, net: 88,
  });
  assert.deepEqual({ ...calculate(200, 100, 20) }, {
    grossAmount: 200, creditsAmount: 100, consumablesAmount: 20,
    garraFee: 20, deliveryNet: 180, net: 260,
  });
});

test('dados financeiros são carregados antes do primeiro repasse', () => {
  assert.match(app, /await fetchRiderConsumables\(\);\s*await fetchRiderCredits\(\);\s*await fetchClientHistory\(\);/);
  assert.match(app, /targetTab === 'owner-rider-payments'[\s\S]{0,300}await fetchRiderCredits\(\);[\s\S]{0,300}await fetchRiderConsumables\(\);/);
});

test('associação mantém rider_id como chave e nome somente como legado', () => {
  assert.match(app, /const key = rider \? String\(rider\.id\) : `legacy:/);
  assert.match(app, /resolveFinancialRider\(c\.rider_id, c\.rider_name\)/);
});

test('dropdown preserva os aliases do tema escuro', () => {
  assert.match(css, /--card-bg: var\(--bg-card\);/);
  assert.match(css, /--input-bg: var\(--bg-input\);/);
});
