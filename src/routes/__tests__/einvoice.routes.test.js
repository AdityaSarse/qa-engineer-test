import { test, describe, before } from 'node:test';
import assert from 'node:assert';

const BASE_URL = 'http://localhost:3000';

async function getAuthToken() {
  const email = `einvoice-${Date.now()}@test.com`;
  const password = 'SecurePassword123!';
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      business_name: 'E-Invoice Test Co'
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

describe('E-Invoice Routes', () => {
  let token;

  before(async () => {
    token = await getAuthToken();
    assert.ok(token, 'Should obtain auth token');
  });

  // ── Bug G: Duplicate e-invoice submissions ───────────────────────────

  test('Bug G: Should reject duplicate e-invoice submission', async () => {
    const invoiceId = `inv_dup_${Date.now()}`;
    const body = { invoice_id: invoiceId, customer_siret: '12345678901234' };

    // First submission should succeed
    const res1 = await fetch(`${BASE_URL}/api/einvoice/submit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    assert.strictEqual(res1.status, 200);

    // Second submission of the same invoice should fail with 409
    const res2 = await fetch(`${BASE_URL}/api/einvoice/submit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    assert.strictEqual(res2.status, 409);
    const data = await res2.json();
    assert.ok(data.error.toLowerCase().includes('already submitted'));
  });

  test('Should submit valid e-invoice successfully', async () => {
    const invoiceId = `inv_valid_${Date.now()}`;
    const res = await fetch(`${BASE_URL}/api/einvoice/submit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        invoice_id: invoiceId,
        customer_siret: '12345678901234'
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.data.status, 'submitted');
    assert.ok(data.data.submission_id.startsWith('SUB-'));
  });

  test('Should reject e-invoice with invalid SIRET (wrong length)', async () => {
    const res = await fetch(`${BASE_URL}/api/einvoice/submit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        invoice_id: `inv_bad_siret_${Date.now()}`,
        customer_siret: '12345'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('Should reject e-invoice without authentication', async () => {
    const res = await fetch(`${BASE_URL}/api/einvoice/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoice_id: 'inv_noauth',
        customer_siret: '12345678901234'
      })
    });
    assert.strictEqual(res.status, 401);
  });

  test('Should check e-invoice status after submission', async () => {
    const invoiceId = `inv_status_${Date.now()}`;

    // Submit first
    await fetch(`${BASE_URL}/api/einvoice/submit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        invoice_id: invoiceId,
        customer_siret: '12345678901234'
      })
    });

    // Check status
    const res = await fetch(`${BASE_URL}/api/einvoice/status/${invoiceId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.data.einvoice_status, 'submitted');
  });
});
