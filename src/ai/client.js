const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HAIKU_MODEL  = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-6';

/**
 * Call Haiku to generate a customer reply.
 * @param {string} system   - Assembled system prompt
 * @param {Array}  messages - Conversation turns ending with the new customer message
 * @returns {{ reply: string, status: string, inputTokens: number, outputTokens: number }}
 */
async function generateReply(system, messages) {
  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 512,
    system,
    messages,
  });

  const raw = response.content[0].text.trim();
  // Strip markdown code fences Haiku sometimes adds despite being told not to
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // Last resort: return raw text as an ongoing reply
    parsed = { reply: stripped, status: 'ongoing' };
  }

  return {
    reply: parsed.reply || '',
    status: parsed.status || 'ongoing',
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: HAIKU_MODEL,
  };
}

/**
 * Call Sonnet to generate a business-specific system prompt from wizard answers.
 * Used in Phase 3 Setup Wizard.
 * @param {Object} wizardAnswers - Answers from the 9-question wizard
 * @returns {{ prompt: string, inputTokens: number, outputTokens: number }}
 */
async function generateBusinessPrompt(wizardAnswers) {
  const instruction = `You are helping set up an AI customer service agent for a Filipino small business on Facebook.
Based on the business owner's answers below, write a detailed system prompt that will guide the AI agent when responding to customers.
The prompt should cover: business identity, products/services, customer tone, FAQs, things to never say, escalation behavior, business hours, and language style.
Use the sample customer messages to calibrate the expected tone and vocabulary.
Write the prompt in second person ("You are the AI assistant for..."). Be specific and actionable.

Business Owner's Answers:
${JSON.stringify(wizardAnswers, null, 2)}

Return only the system prompt text — no preamble, no explanation.`;

  const response = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: instruction }],
  });

  return {
    prompt: response.content[0].text.trim(),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: SONNET_MODEL,
  };
}

/**
 * Classify conversation outcome using Haiku.
 * Called once after a conversation closes (status = 'closing').
 * @param {string} conversationSummary - Last few messages joined as text
 * @returns {'closed_sale'|'follow_up'|'not_interested'}
 */
async function classifyOutcome(conversationSummary) {
  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 16,
    system: 'You classify customer service conversations for a Filipino small business. Reply with exactly one word.',
    messages: [{
      role: 'user',
      content: `Classify this conversation outcome as one of: closed_sale, follow_up, not_interested\n\n${conversationSummary}\n\nOutcome:`,
    }],
  });

  const raw = response.content[0].text.trim().toLowerCase().replace(/[^a-z_]/g, '');
  const valid = ['closed_sale', 'follow_up', 'not_interested'];
  return valid.includes(raw) ? raw : 'follow_up'; // safe default
}

module.exports = { generateReply, generateBusinessPrompt, classifyOutcome, HAIKU_MODEL, SONNET_MODEL };
