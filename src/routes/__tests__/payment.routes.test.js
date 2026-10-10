import { test, describe, before } from 'node:test';
import assert from 'node:assert';

const BASE_URL = 'http://localhost:3000';

/**
 * Helper: Register/Login a test merchant and return a JWT token
 */
async function getAuthToken() {
  const email = `pay-merchant-${Date.now()}@test.com`;
  const password = 'TestPassword123!';
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      business_name: 'Payment Test Merchant'
    })
  });
  const data = await res.json();
  if (data.token) {
    return data.token;
  }
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const loginData = await loginRes.json();
  return loginData.token;
}

describe('Payment Routes', () => {
  let token;
  let testPaymentId;

  before(async () => {
    token = await getAuthToken();
    assert.ok(token, 'Should obtain auth token');

    // Create a real payment fixture for this merchant
    const createRes = await fetch(`${BASE_URL}/api/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: 25.5,
        currency: 'EUR',
        customer_email: 'customer@test.com'
      })
    });
    assert.strictEqual(createRes.status, 201);
    const createData = await createRes.json();
    testPaymentId = createData.data.id;
  });

  // ── Bug A: Amount serialisation ──────────────────────────────────────

  test('Bug A: GET /payments should return amount as number, not string', async () => {
    const res = await fetch(`${BASE_URL}/api/payments`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.ok(data.data.length > 0, 'Should have payment records');
    assert.strictEqual(typeof data.data[0].amount, 'number');
    assert.strictEqual(data.data[0].amount, 25.5);
  });

  test('Bug A: GET /payments/:id should return amount as number', async () => {
    const res = await fetch(`${BASE_URL}/api/payments/${testPaymentId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(typeof data.data.amount, 'number');
    assert.strictEqual(data.data.amount, 25.5);
  });

  // ── Bug B: Maximum amount enforcement ────────────────────────────────

  test('Bug B: POST /payments should reject amount over €50,000', async () => {
    const res = await fetch(`${BASE_URL}/api/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: 999999,
        currency: 'EUR',
        customer_email: 'test@example.com'
      })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.toLowerCase().includes('maximum') || data.error.includes('50,000'));
  });

  test('Bug B: POST /payments should accept amount at exactly €50,000', async () => {
    const res = await fetch(`${BASE_URL}/api/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: 50000,
        currency: 'EUR',
        customer_email: 'test@example.com'
      })
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.data.amount, 50000);
  });

  test('POST /payments should reject zero amount', async () => {
    const res = await fetch(`${BASE_URL}/api/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: 0,
        currency: 'EUR',
        customer_email: 'test@example.com'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('POST /payments should reject negative amount', async () => {
    const res = await fetch(`${BASE_URL}/api/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: -100,
        currency: 'EUR',
        customer_email: 'test@example.com'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('POST /payments should reject invalid currency', async () => {
    const res = await fetch(`${BASE_URL}/api/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: 10,
        currency: 'BTC',
        customer_email: 'test@example.com'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('GET /payments without auth should return 401', async () => {
    const res = await fetch(`${BASE_URL}/api/payments`);
    assert.strictEqual(res.status, 401);
  });
});
