# Bug Fixes

## Fix 1: Payment Amount Data Type (Bug A)

**Bug:** `GET /api/payments` and `GET /api/payments/:id` return `amount` as a string instead of a number.

**Files Changed:**

- `src/routes/payment.routes.js` (lines 16, 52)

**Code Changes:**

```diff
- amount: p.amount.toString(), // ← BUG: Should be number, not string
+ amount: parseFloat(p.amount),
```

```diff
- amount: payment.amount.toString(), // Same bug as above
+ amount: parseFloat(payment.amount),
```

**Why This Fix:**
`parseFloat()` converts the value to a proper JavaScript number. This is preferable to just returning `p.amount` directly because it guarantees a numeric type even if the database layer returns a string (common when migrating from SQLite/Postgres where amounts might be stored as TEXT). This matches the POST endpoint's behavior, which already uses `parseFloat(amount)` when storing.

**Testing:**

```bash
curl http://localhost:3000/api/payments -H "Authorization: Bearer $TOKEN"
# Response: amount is now a number (25.5) not a string ("25.5")
```

---

## Fix 2: Maximum Payment Amount (Bug B)

**Bug:** No upper-bound validation on payment amounts. Accepts €999,999,999.

**Files Changed:**

- `src/routes/payment.routes.js` (lines 75-78)

**Code Changes:**

```diff
- // BUG B: No maximum amount check - allows unrealistic amounts
- // Real systems should have limits (e.g., max €50,000 per transaction)
- // Missing: if (amount > 50000) { return 400 }
+ // FIX B: Enforce maximum payment amount (€50,000 per transaction)
+ if (amount > 50000) {
+   return res.status(400).json({ error: 'Amount exceeds maximum allowed (€50,000)' });
+ }
```

**Why This Fix:**
The €50,000 limit is documented in the codebase comments and is a standard anti-fraud measure in European payment systems. The check is placed after the minimum amount check (`> 0`) so both bounds are validated together. The boundary value (exactly €50,000) is accepted, which follows the principle of least surprise.

**Testing:**

```bash
# Should be rejected (400)
curl -X POST http://localhost:3000/api/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":999999,"currency":"EUR","customer_email":"test@test.com"}'

# Should be accepted (201)
curl -X POST http://localhost:3000/api/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":50000,"currency":"EUR","customer_email":"test@test.com"}'
```

---

## Fix 3: Email Validation Regex (Bug C)

**Bug:** Registration accepts emails without a TLD, like `user@domain`.

**Files Changed:**

- `src/routes/auth.routes.js` (lines 9-14)

**Code Changes:**

```diff
- // BUG C: Email validation is too permissive
+ // FIX C: Email validation now requires a TLD (e.g. .com, .eu)
  function validateEmail(email) {
-   // BUG: This regex allows emails without TLD like "user@domain"
-   const emailRegex = /^[^\s@]+@[^\s@]+$/;
+   // Requires at least one dot in the domain part to ensure a valid TLD
+   const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
```

**Why This Fix:**
Adding `\.[^\s@]+` after the domain part requires at least one dot followed by a TLD. This rejects `user@domain` but accepts `user@domain.com`, `user@sub.domain.eu`, etc. This is not a full RFC 5322 validator (that would be overkill for this context) but catches the most common class of invalid addresses. The fix matches the existing code style — a single regex in the same function.

**Testing:**

```bash
# Should be rejected (400)
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@domain","password":"SecurePass123!","business_name":"Test Co"}'

# Should succeed (201)
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@domain.com","password":"SecurePass123!","business_name":"Test Co"}'
```

---

## Fix 4: Webhook Signature Verification (Bug D)

**Bug:** Webhook endpoint accepts any request regardless of the `x-webhook-signature` header.

**Files Changed:**

- `src/routes/webhook.routes.js` (lines 21-32)

**Code Changes:**

```diff
- // BUG D: No signature verification
- // ...commented out HMAC code...
+ // FIX D: Verify webhook signature using HMAC-SHA256
+ if (!signature) {
+   return res.status(401).json({ error: 'Missing webhook signature' });
+ }
+
+ const expectedSignature = crypto
+   .createHmac('sha256', WEBHOOK_SECRET)
+   .update(JSON.stringify(req.body))
+   .digest('hex');
+
+ // Use timing-safe comparison to prevent timing attacks
+ try {
+   const sigBuffer = Buffer.from(signature, 'hex');
+   const expectedBuffer = Buffer.from(expectedSignature, 'hex');
+   if (sigBuffer.length !== expectedBuffer.length ||
+       !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
+     return res.status(401).json({ error: 'Invalid signature' });
+   }
+ } catch (e) {
+   return res.status(401).json({ error: 'Invalid signature' });
+ }
```

**Why This Fix:**
1. **HMAC-SHA256** is the industry standard for webhook signatures (used by Stripe, Powens, GitHub, etc.).
2. **`crypto.timingSafeEqual()`** prevents timing side-channel attacks where an attacker could incrementally guess the correct signature by measuring response times. A naive `===` comparison leaks information.
3. **Buffer conversion with try/catch** handles malformed hex strings gracefully — if the attacker sends non-hex characters, the catch block rejects it.
4. The secret is read from the `WEBHOOK_SECRET` constant (not hardcoded inline), so it can be swapped for an environment variable in production.

**Testing:**

```bash
# Should be rejected (401) — fake signature
curl -X POST http://localhost:3000/api/webhooks/payment-status \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: fake-signature" \
  -d '{"payment_id":"1","status":"completed","event_id":"evt_1"}'

# Generate valid signature (bash):
BODY='{"payment_id":"1","status":"completed","event_id":"evt_1"}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "test-webhook-secret-key" | cut -d' ' -f2)
curl -X POST http://localhost:3000/api/webhooks/payment-status \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: $SIG" \
  -d "$BODY"
```

---

## Fix 5: Webhook Idempotency (Bug E)

**Bug:** Sending the same `event_id` twice results in the webhook being processed both times.

**Files Changed:**

- `src/routes/webhook.routes.js` (lines 38-56)

**Code Changes:**

```diff
- // BUG E: No idempotency check
- // ...commented out check...
+ // FIX E: Idempotency check — reject duplicate webhook deliveries
+ if (!event_id) {
+   return res.status(400).json({ error: 'event_id required' });
+ }
+
+ if (db.processed_webhooks.includes(event_id)) {
+   return res.status(200).json({ message: 'Already processed' });
+ }

  // ...payment update logic...

- // Mark webhook as processed (if idempotency was implemented)
- // db.processed_webhooks.push(event_id);
+ // Mark webhook as processed for idempotency
+ db.processed_webhooks.push(event_id);
```

**Why This Fix:**
1. **`event_id` is now required** — without it, idempotency cannot be enforced.
2. **Returns 200 (not 409)** for duplicates — this follows the webhook delivery convention. Payment providers retry on non-2xx responses, so returning an error would cause infinite retries. Returning 200 signals "message acknowledged" and stops the retry loop.
3. **Uses the existing `db.processed_webhooks` array** — follows the project's in-memory persistence model. In production, this would be a Redis SET or database table with TTL.

---

## Fix 6: Duplicate Table Order Prevention (Bug F)

**Bug:** Multiple pending orders can be created for the same table simultaneously.

**Files Changed:**

- `src/routes/table-order.routes.js` (lines 44-55)

**Code Changes:**

```diff
- // BUG F: No duplicate order prevention
- // ...commented out check...
+ // FIX F: Prevent duplicate pending orders for the same table
+ const existingOrder = (db.table_orders || []).find(
+   o => o.merchant_id === merchant_id &&
+        o.table_number === table_number &&
+        o.status === 'pending'
+ );
+ if (existingOrder) {
+   return res.status(409).json({ error: 'Table already has a pending order' });
+ }
```

**Why This Fix:**
The check is scoped to `merchant_id + table_number + status === 'pending'`. This means:
- A table can have a new order after the previous one is served/cancelled
- Different merchants can have table #5 simultaneously (multi-tenant)
- Only the `pending` status is blocked — once confirmed/preparing, the table is in use by design

This mirrors real POS systems where a table's physical state (occupied/available) is tracked.

---

## Fix 7: Duplicate E-Invoice Submission Prevention (Bug G)

**Bug:** The same invoice can be submitted to the tax authority multiple times.

**Files Changed:**

- `src/routes/einvoice.routes.js` (lines 50-58)

**Code Changes:**

```diff
- // BUG G: No duplicate submission check
- // ...commented out check...
+ // FIX G: Prevent duplicate e-invoice submissions
+ if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
+   return res.status(409).json({
+     error: 'Invoice already submitted to tax authority'
+   });
+ }
```

**Why This Fix:**
Once an invoice is `submitted` or `accepted` by the tax authority, re-submitting would:
1. Overwrite the original `submission_id` (losing the audit trail)
2. Create duplicate records at the tax authority
3. Potentially trigger compliance warnings

The check allows re-submission if the status is `draft`, `rejected`, or any other non-final state. This is intentional — a rejected invoice should be correctable and re-submittable.
