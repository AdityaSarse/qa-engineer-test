import { test, describe } from 'node:test';
import assert from 'node:assert';

const BASE_URL = 'http://localhost:3000';

describe('Auth Routes', () => {

  // ── Bug C: Email validation ──────────────────────────────────────────

  test('Bug C: Should reject email without TLD (user@domain)', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@domain',
        password: 'SecurePass123!',
        business_name: 'Test Co'
      })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.toLowerCase().includes('email'));
  });

  test('Bug C: Should accept valid email with TLD', async () => {
    const uniqueEmail = `valid-${Date.now()}@merchant.com`;
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail,
        password: 'SecurePass123!',
        business_name: 'Test Co'
      })
    });
    assert.strictEqual(res.status, 201);
  });

  test('Should reject registration with short password', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'shortpw@example.com',
        password: 'abc',
        business_name: 'Test Co'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('Should reject registration with missing business name', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'noname@example.com',
        password: 'SecurePass123!'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('Login with correct credentials should succeed', async () => {
    const email = `login-success-${Date.now()}@example.com`;
    const password = 'CorrectPassword123!';

    // Register user first to ensure account exists and password hashing works
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        business_name: 'Auth Test Merchant'
      })
    });
    assert.strictEqual(regRes.status, 201);
    const regData = await regRes.json();
    assert.ok(regData.user, 'Registration response should contain user');
    assert.strictEqual(regData.user.email, email);

    // Login with exact same credentials to verify password comparison
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    assert.strictEqual(loginRes.status, 200);
    const data = await loginRes.json();
    assert.strictEqual(data.message, 'Login successful');
    assert.ok(data.user, 'Login response should contain user object');
    assert.strictEqual(data.user.email, email);
    assert.ok(data.token, 'Response should include a JWT token');
  });

  test('Login with wrong password should fail', async () => {
    const email = `login-wrongpw-${Date.now()}@example.com`;
    const password = 'CorrectPassword123!';

    // Register user first
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        business_name: 'Auth Test Merchant'
      })
    });
    assert.strictEqual(regRes.status, 201);

    // Attempt login with wrong password
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'WrongPassword123!'
      })
    });
    assert.strictEqual(res.status, 401);
  });
});
