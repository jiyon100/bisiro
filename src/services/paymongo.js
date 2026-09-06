/**
 * PayMongo integration — Checkout Sessions & webhook verification.
 *
 * PLACEHOLDERS — replace these before go-live:
 *   PAYMONGO_SECRET_KEY   in .env  (get from https://dashboard.paymongo.com → API keys)
 *   PAYMONGO_WEBHOOK_SECRET in .env (generated when you register the webhook URL in the dashboard)
 *   SUCCESS_URL / CANCEL_URL below — update to your production domain
 *
 * PayMongo docs: https://developers.paymongo.com/reference
 */

const crypto = require('crypto');

// ─── PLACEHOLDER: base URL & auth ───────────────────────────────────────────
const PAYMONGO_BASE = 'https://api.paymongo.com/v1';

function authHeader() {
  // PayMongo uses HTTP Basic Auth with secret key as the username, no password
  const encoded = Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64');
  return `Basic ${encoded}`;
}

// ─── PLACEHOLDER: your app URLs ─────────────────────────────────────────────
// Change to your live domain when deploying (e.g. https://bisiro.app)
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

/**
 * Create a PayMongo Checkout Session.
 *
 * PLACEHOLDER: this calls the real PayMongo API.
 * In sandbox mode (test key starting with sk_test_), no real money moves.
 * Switch to sk_live_ key after business registration + PayMongo KYB approval.
 *
 * @param {object} opts
 * @param {number}  opts.amountPhp     - Amount in PHP (e.g. 500)
 * @param {string}  opts.description   - Line item description shown on checkout page
 * @param {'topup'|'setup_fee'} opts.type - Used in metadata to identify the payment purpose
 * @param {number}  opts.userId        - Bisiro user ID to credit after payment
 * @returns {Promise<{checkoutUrl: string, sessionId: string}>}
 */
async function createCheckoutSession({ amountPhp, description, type, userId }) {
  // PayMongo amounts are in centavos (PHP × 100)
  const amountCentavos = Math.round(amountPhp * 100);

  // PLACEHOLDER: fetch() built-in is available in Node 18+. If on older Node, install node-fetch.
  const response = await fetch(`${PAYMONGO_BASE}/checkout_sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
    },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [
            {
              currency: 'PHP',
              amount:   amountCentavos,
              name:     description,
              quantity: 1,
            },
          ],
          payment_method_types: ['gcash', 'card'],
          success_url: `${APP_URL}/payment-success.html?type=${type}`,
          cancel_url:  `${APP_URL}/payment-cancel.html`,
          metadata: {
            user_id: String(userId),
            type,
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`PayMongo error ${response.status}: ${JSON.stringify(err)}`);
  }

  const data = await response.json();
  return {
    sessionId:   data.data.id,
    checkoutUrl: data.data.attributes.checkout_url,
  };
}

/**
 * Verify a PayMongo webhook signature.
 *
 * PLACEHOLDER: PAYMONGO_WEBHOOK_SECRET must be set in .env.
 * Register your webhook URL in the PayMongo dashboard under Developers → Webhooks:
 *   URL: https://yourdomain.com/webhooks/paymongo
 *   Events to subscribe: checkout_session.payment.paid
 *
 * @param {string} rawBody   - Raw request body (Buffer or string)
 * @param {string} signature - Value of 'Paymongo-Signature' header
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!process.env.PAYMONGO_WEBHOOK_SECRET) {
    // PLACEHOLDER: allow bypass in dev if secret not yet configured
    console.warn('PAYMONGO_WEBHOOK_SECRET not set — skipping signature verification (dev only)');
    return true;
  }

  // PayMongo signature format: "t=<timestamp>,te=<test_hmac>,li=<live_hmac>"
  // In test mode, verify 'te'. In live mode, verify 'li'.
  const parts = Object.fromEntries(
    signature.split(',').map(part => part.split('='))
  );
  const timestamp = parts.t;
  const hmacKey   = process.env.PAYMONGO_SECRET_KEY?.startsWith('sk_live_') ? parts.li : parts.te;

  if (!timestamp || !hmacKey) return false;

  const payload  = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', process.env.PAYMONGO_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hmacKey));
}

module.exports = { createCheckoutSession, verifyWebhookSignature };
