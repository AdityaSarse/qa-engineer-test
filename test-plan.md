# Test Plan: Webhook Payment Flow

## 1. Test Scope

### In Scope

- `POST /api/webhooks/payment-status` endpoint — end-to-end
- HMAC-SHA256 signature verification
- Idempotency via `event_id` tracking
- Payment status mutation (webhook → database)
- Integration: webhook → payment status → GET verification
- Security: spoofing, replay, timing attacks, injection

### Out of Scope

- UI/frontend behaviour
- Performance and load testing (concurrent > 100 req/s)
- External payment provider integration (Powens, Bridge)
- Socket.IO event emission (tested separately)
- E-invoice webhook endpoint (`/api/webhooks/e-invoice`)

---

## 2. Test Environment

| Component           | Details                                     |
| ------------------- | ------------------------------------------- |
| API Server          | `http://localhost:3000`                      |
| Database            | In-memory (resets on server restart)         |
| Webhook Secret      | `test-webhook-secret-key` (test env only)   |
| Signature Algorithm | HMAC-SHA256, hex-encoded                     |
| Tools               | Node.js test runner, curl, Postman           |
| Test Data           | Seeded payments: id=1 (completed), id=2 (pending) |

### Signature Generation (for manual tests)

```bash
BODY='{"payment_id":"1","status":"completed","event_id":"evt_test"}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "test-webhook-secret-key" | cut -d' ' -f2)
```

Or in Node.js:

```javascript
import crypto from 'crypto';
const body = { payment_id: '1', status: 'completed', event_id: 'evt_test' };
const sig = crypto.createHmac('sha256', 'test-webhook-secret-key')
  .update(JSON.stringify(body)).digest('hex');
```

---

## 3. Test Scenarios

### 3.1 — Valid Webhook with Correct Signature

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | Payment id=1 exists with status "completed"  |
| **Action**       | POST valid body with correct HMAC signature  |
| **Expected**     | 200 OK, `{ success: true, message: "Webhook processed" }` |
| **Verify**       | `GET /api/payments/1` shows updated status   |

### 3.2 — Webhook with Invalid Signature

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | None                                         |
| **Action**       | POST with `x-webhook-signature: fake-signature` |
| **Expected**     | 401 Unauthorized, `{ error: "Invalid signature" }` |
| **Verify**       | Payment status is unchanged                  |

### 3.3 — Webhook with Missing Signature Header

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | None                                         |
| **Action**       | POST without `x-webhook-signature` header    |
| **Expected**     | 401 Unauthorized, `{ error: "Missing webhook signature" }` |
| **Verify**       | Payment status is unchanged                  |

### 3.4 — Duplicate Webhook (Same event_id)

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | Webhook `evt_001` already processed          |
| **Action**       | Send same `event_id: "evt_001"` again        |
| **Expected**     | 200 OK, `{ message: "Already processed" }`   |
| **Verify**       | No side effects (status not re-written, no duplicate DB entries) |

### 3.5 — Webhook for Non-Existent Payment

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | No payment with id=99999                     |
| **Action**       | POST with `payment_id: "99999"`              |
| **Expected**     | 404 Not Found, `{ error: "Payment not found" }` |

### 3.6 — Multiple Status Updates for Same Payment

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | Payment id=2 with status "pending"           |
| **Action**       | Send `status: "processing"` (evt_a), then `status: "completed"` (evt_b) |
| **Expected**     | Both succeed (different event_ids). Final status = "completed" |
| **Verify**       | `GET /api/payments/2` confirms "completed"   |

### 3.7 — Webhook with Missing Required Fields

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | None                                         |
| **Action**       | POST with valid signature but missing `payment_id` |
| **Expected**     | 400 Bad Request                              |

### 3.8 — Webhook with Missing event_id

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | None                                         |
| **Action**       | POST with valid signature, `payment_id` and `status` but no `event_id` |
| **Expected**     | 400 Bad Request, `{ error: "event_id required" }` |

### 3.9 — Webhook with Malformed JSON Body

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | None                                         |
| **Action**       | POST with `Content-Type: application/json` but body is `{invalid json` |
| **Expected**     | 400 Bad Request (Express JSON parser error)  |

### 3.10 — Webhook Replay Attack (Reused Signature + Body)

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | Attacker intercepts a valid webhook call      |
| **Action**       | Replay the exact same request (same body, same signature, same event_id) |
| **Expected**     | 200 OK, `{ message: "Already processed" }` — idempotency prevents re-processing |
| **Notes**        | In production, add timestamp validation to fully prevent replay attacks |

### 3.11 — Concurrent Duplicate Webhooks (Race Condition)

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | Payment exists                               |
| **Action**       | Send 10 identical webhook requests simultaneously (same event_id) |
| **Expected**     | Exactly 1 processes successfully; remaining 9 return "Already processed" |
| **Notes**        | In-memory array is single-threaded in Node.js, so no race condition. In production with a database, this requires `INSERT ... ON CONFLICT` or Redis `SETNX` |

### 3.12 — SQL Injection Attempt in payment_id

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | None                                         |
| **Action**       | POST with `payment_id: "1; DROP TABLE payments;"` |
| **Expected**     | 404 Not Found (no matching payment). No database corruption. |
| **Notes**        | In-memory store uses `Array.find()` — immune to SQL injection. Production databases must use parameterized queries. |

### 3.13 — Webhook Signature Timing Attack

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | Attacker sends many requests with incrementally correct signature prefixes |
| **Action**       | Measure response times for varying signatures |
| **Expected**     | Response times should be constant regardless of how many bytes match |
| **Verify**       | Implementation uses `crypto.timingSafeEqual()` — timing is constant |

### 3.14 — XSS in Status Field

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | Valid payment exists                         |
| **Action**       | POST with `status: "<script>alert(1)</script>"` |
| **Expected**     | Status is stored as-is (API returns JSON, not HTML). Frontend must sanitize. No server-side XSS vector. |

### 3.15 — Webhook with Very Large payment_id

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | None                                         |
| **Action**       | POST with `payment_id: "999999999999999999999999999"` |
| **Expected**     | 404 Not Found (no matching payment). No crash. |

### 3.16 — Webhook Integration: Status Update + GET Verification

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Precondition** | Create a new payment via `POST /api/payments` (status = "pending") |
| **Action**       | Send webhook with valid signature to mark it "completed" |
| **Expected**     | `GET /api/payments/:id` returns `status: "completed"` |
| **Verify**       | End-to-end flow from payment creation → webhook → status query |

---

## 4. Security Tests

| Test                        | Approach                                                    | Pass Criteria                      |
| --------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| Signature spoofing          | Send fabricated `x-webhook-signature`                        | 401 Unauthorized                   |
| Missing signature           | Omit `x-webhook-signature` header entirely                   | 401 Unauthorized                   |
| Timing attack               | Measure response time with correct vs wrong signatures       | Constant time (timingSafeEqual)    |
| Replay attack               | Re-send a previously valid webhook                           | "Already processed" (idempotent)   |
| SQL injection               | Inject SQL in `payment_id`                                   | 404, no data corruption            |
| XSS in payload              | Inject `<script>` tags in `status`                           | Stored as string, no execution     |
| HMAC with wrong secret      | Generate signature with different secret                     | 401 Unauthorized                   |
| Empty signature              | Send `x-webhook-signature: ""`                              | 401 Unauthorized                   |

---

## 5. Edge Cases

| Edge Case                   | Expected Behavior                            |
| --------------------------- | -------------------------------------------- |
| `payment_id` = `null`       | 400 Bad Request                              |
| `event_id` = `null`         | 400 Bad Request                              |
| `event_id` = `""`           | 400 Bad Request                              |
| `status` = `""`             | 400 Bad Request                              |
| Unicode in `status`         | Accepted (no validation on status values)    |
| Very long `event_id`        | Accepted (no length limit in test env)       |
| Future timestamp in body    | Accepted (no timestamp validation currently) |
| Webhook before payment      | 404 Not Found                                |
| Concurrent writes           | Node.js event loop serialises — safe         |

---

## 6. Integration Tests

### 6.1 Webhook → Payment Status → Database

1. Create payment (`POST /api/payments`) → status = "pending"
2. Send webhook with `status: "processing"` → verify GET shows "processing"
3. Send webhook with `status: "completed"` → verify GET shows "completed"
4. Confirm both webhooks recorded in `db.processed_webhooks`

### 6.2 Webhook → Socket.IO Event

1. Connect Socket.IO client to `http://localhost:3000`
2. Join merchant room
3. Send payment webhook
4. Verify client receives `payment_status_changed` event (if implemented)
5. **Note:** Socket.IO emission for payment webhooks is not currently implemented in the codebase — this is a future enhancement

### 6.3 Failed Webhook → Retry Behavior

1. Send webhook with invalid signature → rejected
2. Provider retries with same event_id
3. On retry with valid signature → succeeds
4. Third delivery (same event_id) → "Already processed"

---

## 7. Risk Assessment

### What Could Go Wrong in Production

| Risk                                  | Likelihood | Impact   | Mitigation                                         |
| ------------------------------------- | ---------- | -------- | -------------------------------------------------- |
| Webhook secret leaked/compromised     | Medium     | Critical | Rotate secrets, use env vars, audit access logs    |
| Provider sends duplicate events       | High       | High     | Idempotency via `event_id` (implemented)           |
| Webhook processing fails mid-flight   | Medium     | High     | Use database transactions, implement retry queue   |
| Clock skew allows replay attacks      | Low        | Medium   | Add timestamp validation with configurable window  |
| In-memory DB loses processed events   | High       | Medium   | In production: use Redis/Postgres with TTL         |
| Race condition on concurrent webhooks | Medium     | Medium   | In production: use `SETNX` or `INSERT ON CONFLICT` |

### Detection

- **Monitoring:** Alert on > 5% webhook rejection rate (signature failures)
- **Logging:** Log all webhook attempts (with masked signatures) for audit
- **Health check:** `GET /api/webhooks/health` returning processed event count
- **Anomaly detection:** Flag sudden spikes in webhook volume (DDoS/replay)

### Mitigation Priorities

1. **P0:** Signature verification (Bug D fix) — prevents unauthorized state changes
2. **P0:** Idempotency (Bug E fix) — prevents duplicate processing
3. **P1:** Timestamp validation — add `timestamp` field + 5-minute window check
4. **P1:** Rate limiting — throttle webhook endpoint to prevent abuse
5. **P2:** Persistent idempotency store — migrate from in-memory to Redis/DB
