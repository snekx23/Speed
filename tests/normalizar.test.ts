import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizar99food } from '../supabase/functions/_shared/normalizar.ts';

test('99Food normalizar99food payment methods mapping', () => {
  // Test case 1: Paid online via PIX (customer_need_paying_money is 0, pay_type is 3)
  const payload1 = {
    data: {
      order_id: '123456789',
      order_info: {
        order_index: 42,
        price: {
          customer_need_paying_money: 0,
          pay_type: 3
        },
        payment: {
          pay_type: 3
        }
      }
    }
  };
  const result1 = normalizar99food(payload1);
  assert.equal(result1.payment, 'Já Pago / PIX App');

  // Test case 2: Paid online via Credit Card (customer_need_paying_money is 0, pay_type is 4)
  const payload2 = {
    data: {
      order_id: '123456789',
      order_info: {
        order_index: 42,
        price: {
          customer_need_paying_money: 0,
          pay_type: 4
        },
        payment: {
          pay_type: 4
        }
      }
    }
  };
  const result2 = normalizar99food(payload2);
  assert.equal(result2.payment, 'Já Pago / PIX App');

  // Test case 3: Paid on delivery via Cash (customer_need_paying_money is 2500, pay_type is 1)
  const payload3 = {
    data: {
      order_id: '123456789',
      order_info: {
        order_index: 42,
        price: {
          customer_need_paying_money: 2500,
          pay_type: 1
        },
        payment: {
          pay_type: 1
        }
      }
    }
  };
  const result3 = normalizar99food(payload3);
  assert.equal(result3.payment, 'Dinheiro (Sem troco)');

  // Test case 4: Paid on delivery via Card (customer_need_paying_money is 3000, pay_type is 2)
  const payload4 = {
    data: {
      order_id: '123456789',
      order_info: {
        order_index: 42,
        price: {
          customer_need_paying_money: 3000,
          pay_type: 2
        },
        payment: {
          pay_type: 2
        }
      }
    }
  };
  const result4 = normalizar99food(payload4);
  assert.equal(result4.payment, 'Cartão (Levar Máquina)');
});

test('99Food normalizar99food observations mapping and de-duplication', () => {
  const payload = {
    data: {
      order_id: '123456789',
      order_info: {
        order_index: 42,
        note: 'Deixar na portaria', // General order note
        description: 'deixar na PORTARIA', // duplicate general order note (case insensitive)
        receive_address: {
          reference: 'Apt 302, Bloco C',
          house_number: 'Apt 302, Bloco C', // duplicate location note
          room: 'Sala 4',
          building: 'Edifício das Flores',
          comment: 'Entrar pelo portão lateral',
          remark: 'Apt 302, Bloco C' // duplicate location note
        }
      }
    }
  };

  const result = normalizar99food(payload);
  
  // The expected result should contain:
  // 1. Unique address fields: 'Apt 302, Bloco C', 'Sala 4', 'Edifício das Flores', 'Entrar pelo portão lateral'
  // 2. Followed by unique order fields (that were not in address): 'deixar na PORTARIA' (first occurrence wins)
  // 3. Separated by ' • ' without any artificial cuts or truncation.
  const expectedObservation = 'Apt 302, Bloco C • Sala 4 • Edifício das Flores • Entrar pelo portão lateral • deixar na PORTARIA';
  assert.equal(result.observacao, expectedObservation);
});

test('99Food normalizar99food pickupCode mapping', () => {
  const payload = {
    data: {
      order_id: '123456789',
      order_info: {
        order_index: 42,
        delivery: {
          pickupCode: '9988'
        }
      }
    }
  };

  const result = normalizar99food(payload);
  assert.equal(result.pickup_code, '9988');
});


