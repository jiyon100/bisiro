const pool = require('../db/pool');

// Maps full Anthropic model IDs → pricing_config key prefix
const MODEL_PREFIX = {
  'claude-haiku-4-5-20251001': 'haiku',
  'claude-sonnet-4-6':         'sonnet',
};

// 2.9x markup — see PROJECT_SPEC.md §2
async function calculateCostPhp(inputTokens, outputTokens, model) {
  const prefix = MODEL_PREFIX[model];
  if (!prefix) throw new Error(`Unknown model "${model}" — add it to MODEL_PREFIX in costCalculator.js`);

  const result = await pool.query(
    'SELECT key, value FROM pricing_config WHERE key IN ($1,$2,$3,$4)',
    ['markup_multiplier', 'usd_to_php_rate', `${prefix}_input_price_per_token_usd`, `${prefix}_output_price_per_token_usd`]
  );

  const config = {};
  for (const row of result.rows) config[row.key] = parseFloat(row.value);

  const inputKey  = `${prefix}_input_price_per_token_usd`;
  const outputKey = `${prefix}_output_price_per_token_usd`;

  if (!config[inputKey] || !config[outputKey]) {
    throw new Error(`No pricing_config rows found for model "${model}". Add ${inputKey} and ${outputKey}.`);
  }

  const costUsd = (inputTokens * config[inputKey]) + (outputTokens * config[outputKey]);
  const costPhp = costUsd * config.usd_to_php_rate * config.markup_multiplier;

  return {
    costUsd: parseFloat(costUsd.toFixed(8)),
    costPhp: parseFloat(costPhp.toFixed(4)),
  };
}

module.exports = { calculateCostPhp };
