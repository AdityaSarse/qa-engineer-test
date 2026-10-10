# Bug Reports

## Bug A: Payment Amount Returned as String Instead of Number

**Location:** `src/routes/payment.routes.js` (lines 16, 52)  
**Severity:** Medium  
**Component:** Payment API

**How to Reproduce:**

1. Start server: `npm start`
2. Login: `POST /api/auth/login` with `{"email":"merchant@test.com","password":"Test123!"}`
3. Send request: `GET /api/payments` with JWT token in Authorization header
4. Observe the `amount` field in each payment object

**Expected Behavior:**
`amount` should be a number (e.g., `25.5`) to allow correct arithmetic in frontend code.

**Actual Behavior:**
`amount` is a string (e.g., `"25.5"`). Both `GET /api/payments` and `GET /api/payments/:id` convert the numeric amount to a string via `.toString()`.

**Impact:**
Frontend JavaScript arithmetic on string amounts will produce incorrect results or NaN. For example, `"25.5" + 10` yields `"25.510"` instead of `35.5`. This will silently corrupt totals and receipt displays.

**Root Cause:**
Line 16: `amount: p.amount.toString()` — explicitly converts the stored numeric value to a string before returning it in the response.  
Line 52: `amount: payment.amount.toString()` — same bug in the single-payment endpoint.

**Suggested Fix:**
Replace `.toString()` with `parseFloat(p.amount)` to ensure a numeric return type even if the stored value is somehow a string.

---

## Bug B: No Maximum Payment Amount Validation

**Location:** `src/routes/payment.routes.js` (lines 75-77)  
**Severity:** High  
**Component:** Payment API

**How to Reproduce:**

1. Start server: `npm start`
2. Login and obtain JWT token
3. `POST /api/payments` with `{"amount": 999999999, "currency": "EUR", "customer_email": "test@example.com"}`
4. Observe that the payment is created successfully

**Expected Behavior:**
The API should reject amounts exceeding €50,000 per transaction with a 400 error, as documented in the codebase comments.

**Actual Behavior:**
The API accepts any positive number, including `999999999`. No upper-bound check exists.

**Impact:**
In a production payment system, this allows creation of absurdly large payments (e.g., €999,999,999). This could be exploited for fraud, money laundering, or could simply cause catastrophic financial errors. Payment processors universally enforce per-transaction limits.

**Root Cause:**
Lines 75-77 contain a comment acknowledging the missing check (`// Missing: if (amount > 50000) { return 400 }`) but the actual validation code was never implemented.

**Suggested Fix:**
Add `if (amount > 50000) { return res.status(400).json({ error: 'Amount exceeds maximum allowed (€50,000)' }); }` after the existing minimum amount check.

---

## Bug C: Email Validation Accepts Addresses Without TLD

**Location:** `src/routes/auth.routes.js` (lines 10-14)  
**Severity:** Medium  
**Component:** Auth API

**How to Reproduce:**

1. Start server: `npm start`
2. `POST /api/auth/register` with `{"email":"user@domain","password":"SecurePass123!","business_name":"Test Co"}`
3. Observe that registration succeeds (201)

**Expected Behavior:**
Email validation should require a valid TLD (e.g., `user@domain.com`). `user@domain` is not a deliverable email address.

**Actual Behavior:**
The regex `/^[^\s@]+@[^\s@]+$/` only checks for an `@` symbol with characters on both sides. It accepts `user@domain`, `a@b`, etc.

**Impact:**
Users can register with unreachable email addresses. This breaks password-reset flows, receipt delivery, and compliance requirements (KYC/AML) that depend on verified email addresses.

**Root Cause:**
The regex `^[^\s@]+@[^\s@]+$` does not require a dot in the domain part, so any string of the form `x@y` passes validation.

**Suggested Fix:**
Change regex to `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` which requires at least one dot after the `@` symbol.

---

## Bug D: Webhook Signature Verification Missing (Critical Security Bug)

**Location:** `src/routes/webhook.routes.js` (lines 21-32)  
**Severity:** Critical  
**Component:** Webhooks

**How to Reproduce:**

1. Start server: `npm start`
2. Send: `POST /api/webhooks/payment-status` with header `x-webhook-signature: fake-signature` and body `{"payment_id":"1","status":"completed","event_id":"evt_123"}`
3. Observe that the webhook is accepted and the payment status is updated to "completed"

**Expected Behavior:**
The webhook endpoint should verify the `x-webhook-signature` header using HMAC-SHA256 with the configured secret. Requests with invalid or missing signatures must be rejected with 401.

**Actual Behavior:**
The signature verification code is entirely commented out. Any request — including forged ones — is accepted and can change payment statuses.

**Impact:**
This is a **critical security vulnerability**. An attacker can forge webhook calls to:
- Mark unpaid orders as "completed" (getting goods/services for free)
- Change payment statuses to "refunded" or "failed" to disrupt merchant operations
- Bypass the entire payment flow

**Root Cause:**
Lines 25-32 contain the correct HMAC verification logic, but it is entirely commented out. The endpoint processes all requests regardless of signature.

**Suggested Fix:**
Uncomment and activate the HMAC-SHA256 verification. Use `crypto.timingSafeEqual()` instead of `===` to prevent timing attacks.

---

## Bug E: Webhook Idempotency Missing (Duplicate Processing)

**Location:** `src/routes/webhook.routes.js` (lines 38-44)  
**Severity:** High  
**Component:** Webhooks

**How to Reproduce:**

1. Start server: `npm start`
2. Send `POST /api/webhooks/payment-status` with a valid signature and body `{"payment_id":"1","status":"completed","event_id":"evt_dup"}`
3. Send the exact same request again
4. Both requests return 200 with `"Webhook processed"`

**Expected Behavior:**
The second delivery of the same `event_id` should return 200 with `"Already processed"` without re-applying side effects.

**Actual Behavior:**
Every webhook delivery is processed as new, regardless of whether the same `event_id` was already handled.

**Impact:**
Payment providers (Stripe, Powens, etc.) guarantee **at-least-once** delivery, meaning webhooks will be retried. Without idempotency:
- Payment status could be overwritten (e.g., "completed" → "pending" on retry)
- Side effects (emails, inventory changes) fire multiple times
- Accounting records become inconsistent

**Root Cause:**
Lines 42-44 contain the idempotency check but it is commented out. Line 56 which records processed events is also commented out.

**Suggested Fix:**
Uncomment the `db.processed_webhooks.includes(event_id)` check and the `db.processed_webhooks.push(event_id)` recording. Also require `event_id` in the request body.

---

## Bug F: Duplicate Table Orders Allowed for Same Table

**Location:** `src/routes/table-order.routes.js` (lines 44-55)  
**Severity:** Medium  
**Component:** Table Orders

**How to Reproduce:**

1. Start server: `npm start`
2. `POST /api/table-orders` with `{"merchant_id":"1","table_number":5,"items":[{"name":"Pasta","quantity":1,"price":12.50}]}`
3. Send the exact same request again
4. Both requests succeed with 201

**Expected Behavior:**
A table that already has a pending order should not accept a new order until the existing one is served or cancelled. The second request should return 409 Conflict.

**Actual Behavior:**
Multiple pending orders are created for the same table, leading to confusion in the kitchen and incorrect billing.

**Impact:**
In a restaurant POS system, duplicate pending orders for the same table cause:
- Kitchen prepares the same food twice
- Customer is billed for duplicate items
- Wait staff confusion about which order is current
- Potential inventory and revenue discrepancies

**Root Cause:**
Lines 44-55 contain the duplicate check logic but it is entirely commented out. No validation prevents creating a second pending order for a table.

**Suggested Fix:**
Uncomment the `existingOrder` check that queries `db.table_orders` for a matching `merchant_id`, `table_number`, and `status === 'pending'`.

---

## Bug G: Duplicate E-Invoice Submissions Allowed

**Location:** `src/routes/einvoice.routes.js` (lines 50-58)  
**Severity:** Medium  
**Component:** E-Invoicing

**How to Reproduce:**

1. Start server: `npm start`
2. Login and obtain JWT token
3. `POST /api/einvoice/submit` with `{"invoice_id":"inv_1","customer_siret":"12345678901234"}`
4. Send the exact same request again
5. Both requests succeed (200)

**Expected Behavior:**
An invoice that has already been submitted to the tax authority (status `submitted` or `accepted`) should be rejected with 409 Conflict on subsequent submission attempts.

**Actual Behavior:**
The same invoice can be submitted multiple times. Each submission overwrites the previous `submission_id` and `submitted_at` timestamp.

**Impact:**
In the French e-invoicing system (via Seqino PDP):
- Duplicate submissions to the tax authority may trigger compliance flags or audits
- The `submission_id` from the first successful submission is lost when overwritten
- Tax records become inconsistent between the merchant system and the authority
- Could result in duplicate tax assessments or reporting errors

**Root Cause:**
Lines 50-58 contain the duplicate submission check but it is entirely commented out. No validation prevents re-submitting an already-submitted invoice.

**Suggested Fix:**
Uncomment the check for `invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted'` and return 409 if either condition is true.
