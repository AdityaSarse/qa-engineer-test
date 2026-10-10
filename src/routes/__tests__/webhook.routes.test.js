import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

const BASE_URL = 'http://localhost:3000';
const WEBHOOK_SECRET = 'test-webhook-secret-key';

/**
 * Helper: compute a valid HMAC-SHA256 signature for a request body
 */
function sign(body) {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
}

/**
 * Helper: register/login and return JWT for endpoints that need auth
 */
async function getAuthToken() {
  const email = `webhook-auth-${Date.now()}@test.com`;
  const password = 'TestPassword123!';
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      business_name: 'Webhook Test Merchant'
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

describe('Webhook Routes — Payment Status', () => {

  // ── Bug D: Signature verification ────────────────────────────────────

  test('Bug D: Should reject webhook with fake signature', async () => {
    const body = { payment_id: '1', status: 'completed', event_id: 'evt_fake_sig_test' };
    const res = await fetch(`${BASE_URL}/api/webhooks/payment-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': 'fake-signature'
      },
      body: JSON.stringify(body)
    });
    assert.strictEqual(res.status, 401);
  });

  test('Bug D: Should reject webhook with missing signature header', async () => {
    const body = { payment_id: '1', status: 'completed', event_id: 'evt_no_sig' };
    const res = await fetch(`${BASE_URL}/api/webhooks/payment-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    assert.strictEqual(res.status, 401);
  });

  test('Bug D: Should accept webhook with valid HMAC-SHA256 signature', async () => {
    const eventId = `evt_valid_sig_${Date.now()}`;
    const body = { payment_id: '1', status: 'completed', event_id: eventId };
    const signature = sign(body);

    const res = await fetch(`${BASE_URL}/api/webhooks/payment-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature
      },
      body: JSON.stringify(body)
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.message, 'Webhook processed');
    assert.strictEqual(data.payment_id, '1');
    assert.strictEqual(data.new_status, 'completed');
  });

  // ── Bug E: Idempotency ──────────────────────────────────────────────

  test('Bug E: Duplicate event_id should return 200 "Already processed"', async () => {
    const eventId = `evt_idempotent_${Date.now()}`;
    const body = { payment_id: '2', status: 'completed', event_id: eventId };
    const signature = sign(body);
    const headers = {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature
    };

    // First call should succeed
    const res1 = await fetch(`${BASE_URL}/api/webhooks/payment-status`, {
      method: 'POST', headers, body: JSON.stringify(body)
    });
    assert.strictEqual(res1.status, 200);
    const data1 = await res1.json();
    assert.strictEqual(data1.message, 'Webhook processed');
    assert.strictEqual(data1.new_status, 'completed');

    // Second call with same event_id should be idempotent
    const res2 = await fetch(`${BASE_URL}/api/webhooks/payment-status`, {
      method: 'POST', headers, body: JSON.stringify(body)
    });
    assert.strictEqual(res2.status, 200);
    const data2 = await res2.json();
    assert.strictEqual(data2.message, 'Already processed');
  });

  test('Should reject webhook with missing payment_id', async () => {
    const body = { status: 'completed', event_id: 'evt_missing_pid' };
    const signature = sign(body);
    const res = await fetch(`${BASE_URL}/api/webhooks/payment-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature
      },
      body: JSON.stringify(body)
    });
    assert.strictEqual(res.status, 400);
  });

  test('Should reject webhook with missing event_id', async () => {
    const body = { payment_id: '1', status: 'completed' };
    const signature = sign(body);
    const res = await fetch(`${BASE_URL}/api/webhooks/payment-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature
      },
      body: JSON.stringify(body)
    });
    assert.strictEqual(res.status, 400);
  });

  test('Should return 404 for non-existent payment', async () => {
    const body = { payment_id: '99999', status: 'completed', event_id: 'evt_nonexistent' };
    const signature = sign(body);
    const res = await fetch(`${BASE_URL}/api/webhooks/payment-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature
      },
      body: JSON.stringify(body)
    });
    assert.strictEqual(res.status, 404);
  });

  test('Webhook should actually update payment status', async () => {
    // Create a fresh payment fixture first
    const token = await getAuthToken();
    assert.ok(token, 'Should obtain auth token for creating payment fixture');

    const createRes = await fetch(`${BASE_URL}/api/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: 42.00,
        currency: 'EUR',
        customer_email: 'webhook-test@example.com'
      })
    });
    assert.strictEqual(createRes.status, 201, 'Payment fixture creation should return 201');
    const created = await createRes.json();
    assert.ok(created.data && created.data.id, 'Payment response should contain created payment id');
    const paymentId = created.data.id;

    // Send webhook with valid HMAC-SHA256 signature to mark it completed
    const eventId = `evt_update_${paymentId}_${Date.now()}`;
    const body = { payment_id: paymentId, status: 'completed', event_id: eventId };
    const signature = sign(body);
    const webhookRes = await fetch(`${BASE_URL}/api/webhooks/payment-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature
      },
      body: JSON.stringify(body)
    });
    assert.strictEqual(webhookRes.status, 200, 'Webhook processing should succeed');
    const webhookData = await webhookRes.json();
    assert.strictEqual(webhookData.message, 'Webhook processed');
    assert.strictEqual(webhookData.new_status, 'completed');

    // Verify via GET that status was updated to completed
    const getRes = await fetch(`${BASE_URL}/api/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(getRes.status, 200);
    const payment = await getRes.json();
    assert.strictEqual(payment.data.status, 'completed');
  });
});
