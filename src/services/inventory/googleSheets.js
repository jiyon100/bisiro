// Google Sheets inventory connector.
// Expects a sheet with columns: Product | Stock | Unit | Notes (columns can be in any order,
// detected by header row). The sheet must be either publicly readable OR shared with the
// service account email configured in GOOGLE_SERVICE_ACCOUNT_EMAIL.
//
// Two access modes:
//   1. Public sheet  — set config.api_key (Google Cloud API key with Sheets scope enabled)
//   2. Private sheet — requires GOOGLE_SERVICE_ACCOUNT_JSON env var (service account credentials)

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Fetch inventory rows from a Google Sheet.
 * @param {Object} config - { sheet_id, tab_name?, api_key? }
 * @returns {Array} [{ product, stock, unit, notes }, ...]
 */
async function fetchInventory(config) {
  const { sheet_id, tab_name = 'Sheet1', api_key } = config;

  let url;
  if (api_key) {
    // Public sheet via API key
    const range = encodeURIComponent(`${tab_name}!A1:Z1000`);
    url = `${SHEETS_BASE}/${sheet_id}/values/${range}?key=${api_key}`;
  } else {
    // Private sheet via service account (OAuth2 bearer token)
    const token = await getServiceAccountToken();
    const range  = encodeURIComponent(`${tab_name}!A1:Z1000`);
    url = `${SHEETS_BASE}/${sheet_id}/values/${range}`;
    const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.error) throw new Error(`Google Sheets API error: ${data.error.message}`);
    return parseRows(data.values || []);
  }

  const res  = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`Google Sheets API error: ${data.error.message}`);
  return parseRows(data.values || []);
}

function parseRows(rows) {
  if (rows.length < 2) return [];

  // Detect header row — case-insensitive match
  const headers = rows[0].map(h => h.toLowerCase().trim());
  const col = (names) => names.map(n => headers.indexOf(n)).find(i => i !== -1) ?? -1;

  const productCol = col(['product', 'item', 'name', 'product name', 'item name', 'pangalan']);
  const stockCol   = col(['stock', 'quantity', 'qty', 'available', 'stock qty', 'bilang']);
  const unitCol    = col(['unit', 'uom', 'yunit']);
  const notesCol   = col(['notes', 'remarks', 'note', 'status']);

  if (productCol === -1) throw new Error('Google Sheet must have a "Product" or "Item" column header in the first row.');

  return rows.slice(1)
    .filter(row => row[productCol]?.trim())
    .map(row => ({
      product: row[productCol]?.trim() || '',
      stock:   stockCol !== -1 ? (row[stockCol]?.trim() || 'unknown') : 'unknown',
      unit:    unitCol  !== -1 ? (row[unitCol]?.trim()  || '')        : '',
      notes:   notesCol !== -1 ? (row[notesCol]?.trim() || '')        : '',
    }));
}

async function getServiceAccountToken() {
  const credsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credsJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set');

  const creds = JSON.parse(credsJson);
  const now   = Math.floor(Date.now() / 1000);

  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');

  const crypto   = require('crypto');
  const sign     = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig      = sign.sign(creds.private_key, 'base64url');
  const jwt      = `${header}.${payload}.${sig}`;

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Service account token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

/**
 * Format inventory rows into a compact string the AI can read in its context.
 */
function formatForPrompt(rows) {
  if (!rows.length) return 'No inventory data available.';
  return rows.map(r => {
    const qty   = r.stock !== 'unknown' ? r.stock + (r.unit ? ' ' + r.unit : '') : 'stock unknown';
    const notes = r.notes ? ` (${r.notes})` : '';
    return `${r.product}: ${qty}${notes}`;
  }).join('\n');
}

module.exports = { fetchInventory, formatForPrompt };
