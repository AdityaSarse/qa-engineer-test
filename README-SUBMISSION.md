# QA Engineer Assignment Submission — Aditya Sarse

## Approach

I systematically tested the EU Pay API by exercising every endpoint through manual HTTP requests (curl / PowerShell), then reading the source code to confirm root causes. I reproduced all 7 intentional bugs, fixed each one with minimal, production-quality changes, and wrote 31 automated regression tests across 5 test suites using the Node.js built-in test runner. For webhook security, I implemented HMAC-SHA256 verification with timing-safe comparison and event-level idempotency — both industry-standard patterns used by Stripe, Powens, and GitHub. All 31 tests pass cleanly and all 7 fixes are verified by the automated verification script.

## Summary of Findings

| Bug | Component    | Severity | Status  |
| --- | ------------ | -------- | ------- |
| A   | Payment API  | Medium   | ✅ Fixed |
| B   | Payment API  | High     | ✅ Fixed |
| C   | Auth API     | Medium   | ✅ Fixed |
| D   | Webhooks     | Critical | ✅ Fixed |
| E   | Webhooks     | High     | ✅ Fixed |
| F   | Table Orders | Medium   | ✅ Fixed |
| G   | E-Invoicing  | Medium   | ✅ Fixed |

## Files Changed

- `src/routes/payment.routes.js` — Bugs A, B
- `src/routes/auth.routes.js` — Bug C
- `src/routes/webhook.routes.js` — Bugs D, E
- `src/routes/table-order.routes.js` — Bug F
- `src/routes/einvoice.routes.js` — Bug G
- `scripts/verify-bugs.js` — Updated to verify that all 7 fixes are present and active

## Files Created

- `bug-reports.md` — Detailed bug documentation for all 7 bugs
- `fixes.md` — Explanation of each fix with diffs and rationale
- `test-plan.md` — Comprehensive webhook test plan (16 scenarios)
- `README-SUBMISSION.md` — This file
- `src/routes/__tests__/webhook.routes.test.js` — Webhook tests (8 tests)
- `src/routes/__tests__/table-order.routes.test.js` — Table order tests (4 tests)
- `src/routes/__tests__/einvoice.routes.test.js` — E-invoice tests (5 tests)
- `src/routes/__tests__/payment.routes.test.js` — Payment tests (8 tests)
- `src/routes/__tests__/auth.routes.test.js` — Auth tests (6 tests)

## How to Verify

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Run automated tests (in a separate terminal)
npm test

# 4. Run bug verification script
npm run verify-bugs
```

## Key Design Decisions

1. **Timing-safe signature comparison** — Used `crypto.timingSafeEqual()` instead of `===` to prevent side-channel attacks on HMAC verification.
2. **200 for duplicate webhooks** — Payment providers retry on non-2xx, so returning 200 for "Already processed" prevents infinite retry loops.
3. **`event_id` is required** — Without it, idempotency cannot be enforced. This is a deliberate validation addition.
4. **Boundary value: €50,000 is accepted** — The maximum check uses `> 50000` (not `>=`), so exactly €50,000 is a valid transaction.
