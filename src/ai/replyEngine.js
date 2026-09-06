const { buildPrompt }        = require('./promptBuilder');
const { generateReply }      = require('./client');
const { calculateCostPhp }   = require('./costCalculator');
const { HAIKU_MODEL }        = require('./client');
const { getInventoryContext } = require('../services/inventory');

/**
 * Full reply pipeline: fetch live inventory (if configured) → build prompt → call Haiku → calculate cost.
 * @param {Object} agentConfig         - Row from agent_configs (must have .system_prompt, optionally .user_id)
 * @param {Array}  conversationHistory - Prior turns [{ role, content }, ...]
 * @param {string} newMessage          - Incoming customer message
 * @returns {{ reply, status, costPhp, costUsd, inputTokens, outputTokens }}
 */
async function getReply(agentConfig, conversationHistory, newMessage) {
  // Fetch live stock data if the business has an active integration
  let inventoryContext = null;
  if (agentConfig.user_id) {
    inventoryContext = await getInventoryContext(agentConfig.user_id).catch(() => null);
  }

  const { system, messages } = buildPrompt(
    agentConfig.system_prompt,
    conversationHistory,
    newMessage,
    inventoryContext
  );

  const { reply, status, inputTokens, outputTokens } = await generateReply(system, messages);
  const { costPhp, costUsd } = await calculateCostPhp(inputTokens, outputTokens, HAIKU_MODEL);

  return { reply, status, costPhp, costUsd, inputTokens, outputTokens };
}

module.exports = { getReply };
