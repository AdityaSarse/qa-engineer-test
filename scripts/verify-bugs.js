#!/usr/bin/env node
/**
 * Bug Fix Verification Script
 * Confirms that all 7 bug fixes are present and active in the codebase
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

console.log("🔍 Verifying bug fixes are present in the codebase...\n");

let fixesVerified = 0;

// Fix A: Check payment.routes.js for numeric amount serialization (parseFloat, not toString)
try {
  const paymentRoutesPath = join(projectRoot, "src/routes/payment.routes.js");
  const content = readFileSync(paymentRoutesPath, "utf-8");

  const hasNoToString =
    !content.includes("amount: p.amount.toString()") &&
    !content.includes("amount: payment.amount.toString()");
  const hasParseFloat =
    content.includes("parseFloat(p.amount)") ||
    content.includes("parseFloat(payment.amount)");

  if (hasNoToString && hasParseFloat) {
    console.log("✅ Fix A verified: Payment amount returned as numeric (parseFloat)");
    fixesVerified++;
  } else {
    console.log("❌ Fix A missing: Amount should be serialized as number using parseFloat");
  }
} catch (err) {
  console.log("⚠️  Fix A: Cannot verify (file not found?)");
}

// Fix B: Check payment.routes.js for maximum amount validation (€50,000)
try {
  const paymentRoutesPath = join(projectRoot, "src/routes/payment.routes.js");
  const content = readFileSync(paymentRoutesPath, "utf-8");

  const lines = content.split("\n");
  let hasActualMaxCheck = false;

  for (const line of lines) {
    if (line.trim().startsWith("//")) continue;
    if (
      /amount\s*>\s*50000/.test(line) ||
      (/amount\s*>\s*MAX_AMOUNT/.test(line) && content.includes("50000"))
    ) {
      hasActualMaxCheck = true;
      break;
    }
  }

  if (hasActualMaxCheck) {
    console.log("✅ Fix B verified: Maximum payment amount limit (€50,000) enforced");
    fixesVerified++;
  } else {
    console.log("❌ Fix B missing: Maximum amount check (> 50000) is required");
  }
} catch (err) {
  console.log("⚠️  Fix B: Cannot verify (file not found?)");
}

// Fix C: Check auth.routes.js for email validation requiring TLD
try {
  const authRoutesPath = join(projectRoot, "src/routes/auth.routes.js");
  const content = readFileSync(authRoutesPath, "utf-8");

  const hasTldRegex =
    content.includes("\\.[^\\s@]+") ||
    /@[^\\s@]+\\.[^\\s@]+/.test(content);
  const hasNoPermissiveRegex =
    !content.includes("/^[^\\s@]+@[^\\s@]+$/") &&
    !content.includes("/^[^s@]+@[^s@]+$/");

  if (hasTldRegex && hasNoPermissiveRegex) {
    console.log("✅ Fix C verified: Email validation requires valid domain and TLD");
    fixesVerified++;
  } else {
    console.log("❌ Fix C missing: Email validation must require a TLD");
  }
} catch (err) {
  console.log("⚠️  Fix C: Cannot verify (file not found?)");
}

// Fix D: Check webhook.routes.js for HMAC-SHA256 signature verification
try {
  const webhookRoutesPath = join(projectRoot, "src/routes/webhook.routes.js");
  const content = readFileSync(webhookRoutesPath, "utf-8");

  const hasHmac =
    content.includes("createHmac('sha256'") ||
    content.includes('createHmac("sha256"');
  const hasTimingSafeOrCompare =
    content.includes("timingSafeEqual") ||
    /signature\s*===\s*expectedSignature/.test(content);
  const hasMissingSigCheck = content.includes("!signature");

  if (hasHmac && (hasTimingSafeOrCompare || hasMissingSigCheck)) {
    console.log("✅ Fix D verified: Webhook HMAC-SHA256 signature verification implemented");
    fixesVerified++;
  } else {
    console.log("❌ Fix D missing: Webhook signature verification required");
  }
} catch (err) {
  console.log("⚠️  Fix D: Cannot verify (file not found?)");
}

// Fix E: Check webhook.routes.js for idempotency check on event_id
try {
  const webhookRoutesPath = join(projectRoot, "src/routes/webhook.routes.js");
  const content = readFileSync(webhookRoutesPath, "utf-8");

  const hasIdempotencyCheck =
    /processed_webhooks\.includes\(\s*event_id\s*\)/.test(content) &&
    !content.match(/\/\/.*processed_webhooks\.includes/);
  const hasEventIdCheck = content.includes("!event_id");

  if (hasIdempotencyCheck && hasEventIdCheck) {
    console.log("✅ Fix E verified: Webhook idempotency tracking by event_id implemented");
    fixesVerified++;
  } else {
    console.log("❌ Fix E missing: Webhook idempotency check required");
  }
} catch (err) {
  console.log("⚠️  Fix E: Cannot verify (file not found?)");
}

// Fix F: Check table-order.routes.js for duplicate pending order prevention
try {
  const tableOrderPath = join(projectRoot, "src/routes/table-order.routes.js");
  const content = readFileSync(tableOrderPath, "utf-8");

  const hasDuplicateCheck =
    /existingOrder/.test(content) &&
    /status\s*===\s*['"]pending['"]/.test(content) &&
    !content.match(/\/\/.*existingOrder/);

  if (hasDuplicateCheck) {
    console.log("✅ Fix F verified: Duplicate pending table order prevention implemented");
    fixesVerified++;
  } else {
    console.log("❌ Fix F missing: Duplicate pending table order check required");
  }
} catch (err) {
  console.log("⚠️  Fix F: Cannot verify (file not found?)");
}

// Fix G: Check einvoice.routes.js for duplicate submission prevention
try {
  const einvoicePath = join(projectRoot, "src/routes/einvoice.routes.js");
  const content = readFileSync(einvoicePath, "utf-8");

  const hasDuplicateSubmissionCheck =
    /einvoice_status.*submitted/.test(content) &&
    !content.match(/\/\/.*if.*einvoice_status/);

  if (hasDuplicateSubmissionCheck) {
    console.log("✅ Fix G verified: Duplicate e-invoice submission prevention implemented");
    fixesVerified++;
  } else {
    console.log("❌ Fix G missing: Duplicate e-invoice submission check required");
  }
} catch (err) {
  console.log("⚠️  Fix G: Cannot verify (file not found?)");
}

console.log(`\n📊 Fixes verified: ${fixesVerified}/7`);

if (fixesVerified === 7) {
  console.log("\n✅ All 7 bug fixes are present in the codebase!");
  process.exit(0);
} else {
  console.log("\n⚠️  Some fixes are missing or incomplete. Please check the code.");
  process.exit(1);
}
