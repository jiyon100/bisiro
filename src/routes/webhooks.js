const express = require('express');
const crypto  = require('crypto');
const pool    = require('../db/pool');
const { checkAndIncrement }      = require('../services/rateTracker');
const { getReply }               = require('../ai/replyEngine');
const { classifyOutcome }        = require('../ai/client');
const { verifyWebhookSignature } = require('../services/paymongo');
const { refreshInventoryAccess } = require('../services/inventory');

const router = express.Router();

// Low-balance warning threshold (PROJECT_SPEC §2)
const LOW_BALANCE_THRESHOLD = 50;

// ─── Facebook webhook verification ──────────────────────────────────────────

router.get('/facebook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
    console.log('Facebook webhook verified');
    return res.send(challenge);
  }
  res.status(403).send('Verification failed');
});

// ─── Facebook webhook receiver ───────────────────────────────────────────────

// Raw body is needed for the PayMongo webhook below. For Facebook we use the
// already-parsed req.body (express.json() runs first in server.js).
router.post('/facebook', express.json(), async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately — FB expects 200 within 5s

  const body = req.body;
  if (body.object !== 'page') return;

  for (const entry of body.entry || []) {
    const pageId = entry.id;

    const pageResult = await pool.query(
      'SELECT id, user_id, page_id, page_access_token_encrypted, is_active FROM facebook_pages WHERE page_id = $1',
      [pageId]
    ).catch(err => { console.error('DB lookup error:', err.message); return { rows: [] }; });

    const page = pageResult.rows[0];
    if (!page || !page.is_active) continue;

    // Check user credit balance before doing anything
    const userResult = await pool.query(
      'SELECT credit_balance_php, is_active FROM users WHERE id = $1',
      [page.user_id]
    ).catch(() => ({ rows: [] }));

    const user = userResult.rows[0];
    if (!user || !user.is_active || parseFloat(user.credit_balance_php) <= 0) {
      console.log(`Skipping page ${pageId} — user ${page.user_id} has no credit or is inactive`);
      continue;
    }

    for (const messagingEvent of entry.messaging || []) {
      await handleMessagingEvent(messagingEvent, page);
    }

    for (const change of entry.changes || []) {
      if (change.field === 'feed' && change.value?.item === 'comment') {
        await handleCommentEvent(change.value, page);
      }
    }
  }
});

async function handleMessagingEvent(event, page) {
  const isEcho   = event.message?.is_echo === true;
  const senderId = isEcho ? event.recipient?.id : event.sender?.id;
  const text     = event.message?.text || '';
  const sender   = isEcho ? 'owner' : 'customer';

  if (!senderId || !text) return;

  if (!isEcho) {
    const rate = checkAndIncrement(page.page_id);
    if (!rate.allowed) {
      console.log(`Rate limit hit for page ${page.page_id} (${rate.count}/${rate.limit})`);
      return;
    }
  }

  try {
    const conv = await getOrCreateConversation(page, senderId, 'dm');
    await saveMessage(conv.id, sender, text);

    if (isEcho) {
      await pool.query(
        `UPDATE conversations SET ai_paused = true, pause_type = 'pending', pause_started_at = NOW()
         WHERE id = $1 AND ai_paused = false`,
        [conv.id]
      );
      console.log(`Human handoff detected for conversation ${conv.id}`);
      return;
    }

    // Skip if AI is paused for this conversation
    const convRow = await pool.query('SELECT ai_paused FROM conversations WHERE id = $1', [conv.id]);
    if (convRow.rows[0]?.ai_paused) return;

    await generateAndSendReply(conv, page, text, 'dm', senderId);
  } catch (err) {
    console.error('Error handling messaging event:', err.message);
  }
}

async function handleCommentEvent(value, page) {
  const senderId   = value.from?.id;
  const text       = value.message || '';
  const commentId  = value.comment_id;
  if (!senderId || !text) return;

  const rate = checkAndIncrement(page.page_id);
  if (!rate.allowed) {
    console.log(`Rate limit hit for page ${page.page_id} (${rate.count}/${rate.limit})`);
    return;
  }

  try {
    const conv = await getOrCreateConversation(page, senderId, 'comment', value.from?.name);
    await saveMessage(conv.id, 'customer', text);
    await generateAndSendReply(conv, page, text, 'comment', senderId, commentId);
  } catch (err) {
    console.error('Error handling comment event:', err.message);
  }
}

async function generateAndSendReply(conv, page, customerMessage, replyType, recipientId, commentId) {
  // Load agent config for this page's user
  const agentResult = await pool.query(
    'SELECT id, system_prompt, user_id FROM agent_configs WHERE user_id = $1 LIMIT 1',
    [page.user_id]
  );
  if (!agentResult.rows[0]) {
    console.log(`No active agent config for user ${page.user_id}`);
    return;
  }
  const agentConfig = agentResult.rows[0];

  // Load recent conversation history (last 10 messages)
  const histResult = await pool.query(
    `SELECT sender, content AS text FROM conversation_messages
     WHERE conversation_id = $1 ORDER BY sent_at DESC LIMIT 10`,
    [conv.id]
  );
  const history = histResult.rows
    .reverse()
    .map(r => ({ role: r.sender === 'customer' ? 'user' : 'assistant', content: r.text }));

  // Generate AI reply
  const { reply, status, costPhp, costUsd, inputTokens, outputTokens } =
    await getReply(agentConfig, history, customerMessage);

  if (status === 'spam') {
    console.log(`Spam detected in conversation ${conv.id} — not replying`);
    await pool.query(
      'UPDATE conversations SET status = $1 WHERE id = $2',
      ['spam', conv.id]
    );
    return;
  }

  // PLACEHOLDER: Send reply via Facebook Graph API
  // Replace this block with the real Graph API call once FB credentials are live.
  // For DMs:      POST https://graph.facebook.com/v19.0/me/messages
  // For comments: POST https://graph.facebook.com/v19.0/{comment-id}/comments
  // Auth: ?access_token=<decrypted page access token>
  await sendFacebookReply({ page, replyType, recipientId, commentId, reply });

  // Save AI reply to conversation
  await saveMessage(conv.id, 'ai', reply);
  await pool.query(
    'UPDATE conversations SET status = $1, last_message_at = NOW() WHERE id = $2',
    [status, conv.id]
  );

  // Auto-tag outcome when conversation is closing — fire async, don't block reply — PROJECT_SPEC §7
  if (status === 'closing') {
    tagConversationOutcome(conv.id).catch(err =>
      console.error(`Outcome tagging failed for conv ${conv.id}:`, err.message)
    );
  }

  // Deduct cost from user balance and log everything
  await deductAndLog({ agentConfig, conv, reply, status, costPhp, costUsd, inputTokens, outputTokens });
}

async function sendFacebookReply({ page, replyType, recipientId, commentId, reply }) {
  const { decrypt } = require('../services/tokenEncryption');
  let accessToken;
  try {
    accessToken = decrypt(page.page_access_token_encrypted);
  } catch (err) {
    console.error(`Token decrypt failed for page ${page.page_id}:`, err.message);
    return;
  }

  try {
    if (replyType === 'dm') {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/me/messages?access_token=${accessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { id: recipientId }, message: { text: reply } }),
        }
      );
      const data = await res.json();
      if (data.error) {
        console.error(`FB send DM error for page ${page.page_id}:`, data.error.message);
        if (data.error.code === 190) await deactivatePage(page.page_id);
      } else {
        console.log(`DM sent to ${recipientId} on page ${page.page_id}`);
      }
    } else if (replyType === 'comment') {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${commentId}/comments?access_token=${accessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: reply }),
        }
      );
      const data = await res.json();
      if (data.error) {
        console.error(`FB comment reply error for page ${page.page_id}:`, data.error.message);
        if (data.error.code === 190) await deactivatePage(page.page_id);
      } else {
        console.log(`Comment reply sent on page ${page.page_id}`);
      }
    }
  } catch (err) {
    console.error(`Network error sending FB reply for page ${page.page_id}:`, err.message);
  }
}

async function deductAndLog({ agentConfig, conv, reply, status, costPhp, costUsd, inputTokens, outputTokens }) {
  const userId = agentConfig.user_id;

  // Atomically deduct balance and return new balance
  const balResult = await pool.query(
    `UPDATE users
     SET credit_balance_php = GREATEST(0, credit_balance_php - $1)
     WHERE id = $2
     RETURNING credit_balance_php`,
    [costPhp, userId]
  );
  const newBalance = parseFloat(balResult.rows[0]?.credit_balance_php || 0);

  // Write reply log (schema: 004_reply_logs.sql)
  await pool.query(
    `INSERT INTO reply_logs
       (user_id, facebook_page_id, reply_type, input_tokens, output_tokens,
        cost_usd, cost_php, message_preview)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [userId, conv.facebook_page_id, conv.type || 'dm',
     inputTokens, outputTokens, costUsd, costPhp,
     reply.substring(0, 500)]
  );

  // Write credit transaction
  await pool.query(
    `INSERT INTO credit_transactions (user_id, type, amount_php, description)
     VALUES ($1, 'deduction', $2, 'AI reply cost')`,
    [userId, costPhp]
  );

  // Auto-pause if balance is now 0
  if (newBalance <= 0) {
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [userId]);
    await createNotification(userId, 'automation_paused',
      'Your Bisiro automation has been paused — your credit balance reached ₱0. Top up to resume.');
    console.log(`User ${userId} automation paused — zero balance`);
  } else if (newBalance < LOW_BALANCE_THRESHOLD) {
    // Only create a low-balance notification once per day (check if recent one exists)
    const recent = await pool.query(
      `SELECT id FROM notifications
       WHERE user_id = $1 AND type = 'low_balance' AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );
    if (!recent.rows.length) {
      await createNotification(userId, 'low_balance',
        `Your Bisiro credit balance is low (₱${newBalance.toFixed(2)}). Top up to avoid interruptions.`);
    }
  }
}

async function createNotification(userId, type, message) {
  await pool.query(
    'INSERT INTO notifications (user_id, type, message) VALUES ($1, $2, $3)',
    [userId, type, message]
  );
}

// ─── PayMongo webhook ────────────────────────────────────────────────────────

// Must receive raw body for signature verification — use express.raw() on this route.
// In server.js this route is mounted BEFORE express.json(), so req.body is a Buffer here.
router.post('/paymongo', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['paymongo-signature'];
  const rawBody   = req.body; // Buffer (express.raw)

  // PLACEHOLDER: verifyWebhookSignature returns true in dev if PAYMONGO_WEBHOOK_SECRET is unset
  if (!verifyWebhookSignature(rawBody, signature || '')) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // We only care about successful payments
  if (event.data?.attributes?.type !== 'checkout_session.payment.paid') {
    return res.sendStatus(200);
  }

  const session  = event.data.attributes.data;
  const metadata = session?.attributes?.metadata || {};
  const userId   = parseInt(metadata.user_id, 10);
  const type     = metadata.type; // 'topup' | 'setup_fee'
  const amountCentavos = session?.attributes?.line_items?.[0]?.amount || 0;
  const amountPhp      = amountCentavos / 100;
  const sessionId      = session?.id;
  const paymongoId     = session?.attributes?.payments?.[0]?.id || null;

  if (!userId || !type || !amountPhp) {
    console.error('PayMongo webhook missing metadata:', metadata);
    return res.sendStatus(200); // Still 200 so PayMongo doesn't retry
  }

  try {
    if (type === 'topup') {
      await handleTopupPaid(userId, amountPhp, sessionId, paymongoId);
    } else if (type === 'setup_fee') {
      await handleSetupFeePaid(userId, amountPhp, sessionId, paymongoId);
    }
  } catch (err) {
    console.error('PayMongo webhook processing error:', err.message);
  }

  res.sendStatus(200);
});

async function handleTopupPaid(userId, amountPhp, sessionId, paymongoId) {
  await pool.query(
    `UPDATE credit_transactions SET status = 'confirmed', updated_at = NOW(),
     paymongo_id = COALESCE(paymongo_id, $3),
     description = COALESCE(description, 'PayMongo session ' || $2)
     WHERE user_id = $1 AND type = 'topup' AND status = 'pending'
       AND description LIKE '%' || $2 || '%'`,
    [userId, sessionId, paymongoId]
  );

  await pool.query(
    'UPDATE users SET credit_balance_php = credit_balance_php + $1 WHERE id = $2',
    [amountPhp, userId]
  );

  // Re-activate if previously paused due to zero balance
  await pool.query(
    `UPDATE users SET is_active = true
     WHERE id = $1 AND is_active = false AND setup_fee_paid = true`,
    [userId]
  );

  // Check if this top-up qualifies user for inventory access (≥₱1,000 in 30 days)
  await refreshInventoryAccess(userId);

  await createNotification(userId, 'payment_received',
    `₱${amountPhp.toFixed(2)} credit has been added to your Bisiro account.`);

  console.log(`Top-up ₱${amountPhp} credited to user ${userId}`);
}

async function handleSetupFeePaid(userId, amountPhp, sessionId, paymongoId) {
  await pool.query(
    `UPDATE credit_transactions SET status = 'confirmed', updated_at = NOW(),
     paymongo_id = COALESCE(paymongo_id, $3),
     description = COALESCE(description, 'PayMongo session ' || $2)
     WHERE user_id = $1 AND type = 'setup_fee' AND status = 'pending'
       AND description LIKE '%' || $2 || '%'`,
    [userId, sessionId, paymongoId]
  );

  // Activate the account
  await pool.query(
    'UPDATE users SET setup_fee_paid = true, is_active = true WHERE id = $1',
    [userId]
  );

  await createNotification(userId, 'payment_received',
    'Your Bisiro account is now active. Connect your Facebook Page to get started.');

  console.log(`Setup fee paid — user ${userId} account activated`);
}

// Fetch last 20 messages, classify outcome with one Haiku call, save to conversations.
async function tagConversationOutcome(convId) {
  const { rows } = await pool.query(
    `SELECT sender, content FROM conversation_messages
     WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [convId]
  );
  if (!rows.length) return;

  const summary = rows
    .reverse()
    .map(r => `${r.sender === 'customer' ? 'Customer' : 'AI'}: ${r.content}`)
    .join('\n');

  const tag = await classifyOutcome(summary);

  await pool.query(
    `UPDATE conversations SET outcome_tag = $1, status = 'ended' WHERE id = $2`,
    [tag, convId]
  );
  console.log(`Conv ${convId} tagged: ${tag}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getOrCreateConversation(page, customerPsid, type, customerName) {
  const existing = await pool.query(
    'SELECT id, ai_paused, facebook_page_id FROM conversations WHERE facebook_page_id = $1 AND customer_psid = $2',
    [page.id, customerPsid]
  );
  if (existing.rows[0]) {
    await pool.query('UPDATE conversations SET last_message_at = NOW() WHERE id = $1', [existing.rows[0].id]);
    return { ...existing.rows[0], type };
  }

  const created = await pool.query(
    `INSERT INTO conversations (user_id, facebook_page_id, customer_psid, customer_name, status)
     VALUES ($1, $2, $3, $4, 'ongoing') RETURNING id, ai_paused, facebook_page_id`,
    [page.user_id, page.id, customerPsid, customerName || null]
  );
  return { ...created.rows[0], type };
}

async function saveMessage(conversationId, sender, content) {
  await pool.query(
    'INSERT INTO conversation_messages (conversation_id, sender, content) VALUES ($1, $2, $3)',
    [conversationId, sender, content]
  );
}

async function deactivatePage(pageId) {
  await pool.query('UPDATE facebook_pages SET is_active = false WHERE page_id = $1', [pageId]);
  console.warn(`Page ${pageId} deactivated — Graph API returned error 190 (invalid token)`);
}

module.exports = router;
module.exports.deactivatePage = deactivatePage;
