const express = require('express');
const pool    = require('../db/pool');
const { generateBusinessPrompt } = require('../ai/client');
const { getReply }               = require('../ai/replyEngine');

const router = express.Router();

// POST /api/wizard/generate
// Takes the 9 wizard answers, calls Sonnet to generate a business system prompt,
// stores the result in agent_configs, returns the generated prompt for owner review.
router.post('/generate', async (req, res) => {
  const userId = req.session.userId || req.body.user_id || 1; // fallback to test user

  const {
    business_name,
    what_you_sell,
    product_catalog,
    variants,
    stock_rules,
    payment_delivery,
    return_policy,
    typical_customers,
    tone,
    never_say,
    escalation_behavior,
    business_hours,
    languages,
    sample_messages,
  } = req.body;

  if (!business_name || !what_you_sell) {
    return res.status(400).json({ error: 'business_name and what_you_sell are required' });
  }

  try {
    const { prompt, inputTokens, outputTokens } = await generateBusinessPrompt({
      business_name,
      what_you_sell,
      product_catalog,
      variants,
      stock_rules,
      payment_delivery,
      return_policy,
      typical_customers,
      tone,
      never_say,
      escalation_behavior,
      business_hours,
      languages,
      sample_messages,
    });

    const result = await pool.query(
      `INSERT INTO agent_configs (user_id, system_prompt, business_context, tone, language_preference, sample_messages)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        userId,
        prompt,
        what_you_sell,
        tone || null,
        languages || 'taglish',
        Array.isArray(sample_messages) ? sample_messages.join('\n') : (sample_messages || null),
      ]
    );

    res.json({
      agent_config_id: result.rows[0].id,
      system_prompt: prompt,
      tokens_used: { input: inputTokens, output: outputTokens },
    });
  } catch (err) {
    console.error('Wizard generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/wizard/preview
// "Test your bot" — runs a sample message through the reply engine without writing to DB.
router.post('/preview', async (req, res) => {
  const { system_prompt, sample_message, conversation_history } = req.body;

  if (!system_prompt || !sample_message) {
    return res.status(400).json({ error: 'system_prompt and sample_message are required' });
  }

  try {
    const result = await getReply(
      { system_prompt },
      conversation_history || [],
      sample_message
    );
    res.json(result);
  } catch (err) {
    console.error('Wizard preview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/wizard/prompt/:id
// Owner edits the generated prompt before saving.
router.put('/prompt/:id', async (req, res) => {
  const { system_prompt } = req.body;
  const { id } = req.params;

  if (!system_prompt) return res.status(400).json({ error: 'system_prompt is required' });

  try {
    await pool.query(
      'UPDATE agent_configs SET system_prompt = $1, updated_at = NOW() WHERE id = $2',
      [system_prompt, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wizard/config — get current agent config for the AI Setup page
router.get('/config', async (req, res) => {
  const userId = req.session.userId || req.query.user_id || 1;
  try {
    const { rows } = await pool.query(
      `SELECT id, system_prompt, business_context, tone, language_preference, sample_messages, created_at
       FROM agent_configs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'No config found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
