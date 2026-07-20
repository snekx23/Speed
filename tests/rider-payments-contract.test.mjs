import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

// Loading contracts: the owner login and weekly payout tab must load both
// financial sources before rendering the weekly payout.
assert.match(app, /await fetchRiderConsumables\(\);\s*await fetchRiderCredits\(\);\s*await fetchClientHistory\(\);/);
assert.match(app, /targetTab === 'owner-rider-payments'[\s\S]{0,300}await fetchRiderCredits\(\);[\s\S]{0,300}await fetchRiderConsumables\(\);/);

// Association contracts: technical rider IDs take priority; legacy names use
// normalization and financial keys are not escaped HTML values.
assert.match(app, /const key = rider \? String\(rider\.id\) : `legacy:/);
assert.match(app, /resolveFinancialRider\(c\.rider_id, c\.rider_name\)/);
assert.match(app, /rider_id: String\(item\.rider_id \?\? ''\)/);
assert.match(app, /rider_name: String\(item\.rider_name \?\? ''\)/);
assert.match(app, /function calculateRiderWeeklyPayment\(gross, credits, consumables\)/);
assert.match(app, /const garraFee = \(grossAmount \+ creditsAmount\) \* 0\.10;/);
assert.match(app, /const net = grossAmount \+ creditsAmount - garraFee - consumablesAmount;/);
assert.match(app, /calculateRiderWeeklyPayment\(\s*grandTotalGross,\s*grandTotalCredits,\s*grandTotalConsumables,/);
assert.match(app, /item\.target_date/);
assert.match(app, /item\.data_competencia \? parseLocalDate\(item\.data_competencia\) : new Date\(item\.created_at\)/);

// Evaluate the actual normalization helpers in isolation. Unicode escapes keep
// this test independent from terminal code pages on Windows.
const helpers = app.match(/function normalizeRiderName[\s\S]+?(?=\/\/ Global Chart)/)?.[0];
assert.ok(helpers, 'financial helpers found');
const context = {
  mockData: {
    fleet: [
      { id: '#MB-1001', name: 'Jo\u00e3o da Silva' },
      { id: '#MB-1002', name: 'Maria Souza' },
    ],
  },
};
vm.createContext(context);
vm.runInContext(helpers, context);
assert.equal(context.normalizeRiderName('  JO\u00c3O   DA  SILVA  '), 'joao da silva');
assert.equal(context.normalizeRiderName('Jo\u00e3o &amp; Silva'), 'joao & silva');
assert.equal(context.resolveFinancialRider('#MB-1001', 'Other').id, '#MB-1001');
assert.equal(context.resolveFinancialRider('', ' jo\u00e3o  da silva ').id, '#MB-1001');
assert.equal(context.resolveFinancialRider('#MB-9999', 'Maria Souza').id, '#MB-1002');

// Financial contract: credits remain gross in their own column, but the Garra
// fee applies to gross rides plus credits. Consumables are deducted afterwards.
const paymentCalculator = app.match(/function calculateRiderWeeklyPayment[\s\S]+?(?=function renderRiderPayments)/)?.[0];
assert.ok(paymentCalculator, 'weekly payment calculator found');
const paymentContext = {};
vm.createContext(paymentContext);
vm.runInContext(paymentCalculator, paymentContext);
assert.deepEqual(
  { ...paymentContext.calculateRiderWeeklyPayment(0, 100, 20) },
  { garraFee: 10, net: 70 },
);
assert.deepEqual(
  { ...paymentContext.calculateRiderWeeklyPayment(200, 100, 20) },
  { garraFee: 30, net: 250 },
);
assert.deepEqual(
  { ...paymentContext.calculateRiderWeeklyPayment(100, 0, 20) },
  { garraFee: 10, net: 70 },
);

// Visual contract: legacy aliases resolve to existing dark-theme tokens and
// native select focus remains visible.
assert.match(css, /--card-bg: var\(--bg-card\);/);
assert.match(css, /--input-bg: var\(--bg-input\);/);
assert.match(css, /select:focus\s*\{[\s\S]*outline: 2px solid var\(--primary-glow\);/);

console.log('rider-payments contract checks passed');
