import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const shared = readFileSync(new URL('../public/financial-calculations.js', import.meta.url), 'utf8');
const moto = readFileSync(new URL('../public/motoboy.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(shared, context);

const financial = context.window.GarraFinancial;

function groupDeliveryGrossByWeek(deliveries) {
  return deliveries.reduce((groups, delivery) => {
    const createdAt = financial.getCreatedAtDate(delivery);
    if (!createdAt) return groups;
    const key = financial.getLocalWeekKey(createdAt);
    groups.set(key, (groups.get(key) || 0) + (Number(delivery.gross) || 0));
    return groups;
  }, new Map());
}

test('texto visual Hoje não desloca entrega criada na semana anterior', () => {
  const groups = groupDeliveryGrossByWeek([
    { date: 'Hoje, 16:09', created_at: '2026-07-19T23:30:00-03:00', gross: 8 },
  ]);
  assert.equal(groups.get('2026-07-13'), 8);
  assert.equal(groups.has('2026-07-20'), false);
});

test('94 entregas permanecem juntas na semana de 13 a 19 de julho', () => {
  const deliveries = Array.from({ length: 94 }, (_, index) => ({
    date: 'Hoje, 16:09',
    created_at: `2026-07-${String(13 + (index % 7)).padStart(2, '0')}T12:00:00-03:00`,
    gross: index < 20 ? 9 : 8,
  }));
  const groups = groupDeliveryGrossByWeek(deliveries);
  assert.equal(groups.size, 1);
  assert.equal(groups.get('2026-07-13'), 772);
});

test('entregas e créditos usam a regra líquida única', () => {
  const payment = financial.calculateWeeklyRiderPayment(772, 490, 0);
  assert.equal(payment.garraFee, 77.2);
  assert.equal(payment.deliveryNet, 694.8);
  assert.equal(payment.net, 1184.8);
});

test('semana somente com crédito fica pendente e preserva o crédito líquido', () => {
  const payment = financial.calculateWeeklyRiderPayment(0, 490, 0);
  assert.equal(payment.garraFee, 0);
  assert.equal(payment.net, 490);
  assert.match(moto, /creditsList: \[\],\s*isPaid: false/);
});

test('virada de mês e ano respeita segunda-feira do calendário local', () => {
  assert.equal(financial.getLocalWeekKey(new Date('2026-12-31T23:30:00-03:00')), '2026-12-28');
  assert.equal(financial.getLocalWeekKey(new Date('2027-01-03T23:30:00-03:00')), '2026-12-28');
  assert.equal(financial.getLocalWeekKey(new Date('2027-01-04T00:30:00-03:00')), '2027-01-04');
});

test('PWA e painel usam created_at e o mesmo cálculo compartilhado', () => {
  assert.match(moto, /GarraFinancial\.getCreatedAtDate\(order\)/);
  assert.match(app, /GarraFinancial\.getCreatedAtDate\(order\)/);
  assert.match(moto, /GarraFinancial\.getLocalWeekKey\(orderDate\)/);
  assert.match(app, /GarraFinancial\.calculateWeeklyRiderPayment/);
  assert.match(moto, /GarraFinancial\.calculateWeeklyRiderPayment/);
  assert.doesNotMatch(moto, /parseOrderDate\(order\.date\)/);
  assert.doesNotMatch(app, /parseOrderDate\(order\.date, order\.created_at\)/);
});
