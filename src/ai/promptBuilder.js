const PLATFORM_BASE_PROMPT = require('./platformPrompt');

/**
 * Assembles the full message array for the Anthropic API.
 * @param {string}      businessPrompt  - Business-specific system prompt from agent_configs
 * @param {Array}       history         - Prior turns: [{ role: 'user'|'assistant', content: string }, ...]
 * @param {string}      newMessage      - The incoming customer message
 * @param {string|null} inventoryContext - Live stock data from an integration, or null
 * @returns {Object} { system, messages } ready for client.messages.create()
 */
function buildPrompt(businessPrompt, history = [], newMessage, inventoryContext = null) {
  const inventorySection = inventoryContext
    ? `\n\nLIVE INVENTORY (fetched right now — use this for all stock/availability questions):\n${inventoryContext}`
    : '';

  const system = [PLATFORM_BASE_PROMPT, businessPrompt + inventorySection].join('\n\n---\n\n');

  // Keep last 10 turns to stay within token budget while preserving context
  const recentHistory = history.slice(-10);

  const messages = [
    ...recentHistory,
    { role: 'user', content: newMessage },
  ];

  return { system, messages };
}

module.exports = { buildPrompt };
