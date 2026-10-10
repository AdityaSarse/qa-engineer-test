import { test, describe, before } from 'node:test';
import assert from 'node:assert';

const BASE_URL = 'http://localhost:3000';

describe('Table Order Routes', () => {

  // ── Bug F: Duplicate pending orders ──────────────────────────────────

  test('Bug F: Should reject duplicate pending order for the same table', async () => {
    const tableNumber = 100 + Math.floor(Math.random() * 900); // avoid collisions
    const orderBody = {
      merchant_id: '1',
      table_number: tableNumber,
      items: [{ name: 'Pasta', quantity: 1, price: 12.50 }]
    };

    // First order should succeed
    const res1 = await fetch(`${BASE_URL}/api/table-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderBody)
    });
    assert.strictEqual(res1.status, 201);

    // Second order for the same table (still pending) should fail with 409
    const res2 = await fetch(`${BASE_URL}/api/table-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderBody)
    });
    assert.strictEqual(res2.status, 409);
    const data = await res2.json();
    assert.ok(data.error.toLowerCase().includes('pending'));
  });

  test('Should create table order with valid data', async () => {
    const tableNumber = 2000 + Math.floor(Math.random() * 900);
    const res = await fetch(`${BASE_URL}/api/table-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant_id: '1',
        table_number: tableNumber,
        items: [
          { name: 'Burger', quantity: 2, price: 9.99 },
          { name: 'Fries', quantity: 1, price: 3.50 }
        ],
        customer_name: 'John'
      })
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.data.status, 'pending');
    assert.strictEqual(data.data.total, 2 * 9.99 + 3.50);
  });

  test('Should reject order with empty items array', async () => {
    const res = await fetch(`${BASE_URL}/api/table-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant_id: '1',
        table_number: 999,
        items: []
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('Should reject order with missing fields', async () => {
    const res = await fetch(`${BASE_URL}/api/table-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table_number: 5
      })
    });
    assert.strictEqual(res.status, 400);
  });
});
