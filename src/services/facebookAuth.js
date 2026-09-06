const crypto = require('crypto');
const pool = require('../db/pool');
const { encrypt } = require('./tokenEncryption');

const FB_APP_ID     = () => process.env.FB_APP_ID;
const FB_APP_SECRET = () => process.env.FB_APP_SECRET;
const APP_URL       = () => process.env.APP_URL || 'http://localhost:3000';

function generatePKCE() {
  const verifier  = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function buildLoginURL(challenge, state) {
  const params = new URLSearchParams({
    client_id:             FB_APP_ID(),
    redirect_uri:          `${APP_URL()}/auth/facebook/callback`,
    scope:                 'pages_manage_engagement,pages_messaging,pages_read_engagement,pages_read_user_content,pages_manage_metadata',
    response_type:         'code',
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

async function exchangeCodeForUserToken(code, verifier) {
  const params = new URLSearchParams({
    client_id:     FB_APP_ID(),
    client_secret: FB_APP_SECRET(),
    redirect_uri:  `${APP_URL()}/auth/facebook/callback`,
    code,
    code_verifier: verifier,
  });
  const res  = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(`FB token exchange failed: ${data.error.message}`);
  return data.access_token; // short-lived user token
}

async function getLongLivedUserToken(shortToken) {
  const params = new URLSearchParams({
    grant_type:        'fb_exchange_token',
    client_id:         FB_APP_ID(),
    client_secret:     FB_APP_SECRET(),
    fb_exchange_token: shortToken,
  });
  const res  = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(`FB long-lived token failed: ${data.error.message}`);
  return data.access_token;
}

async function getPageTokens(longLivedUserToken) {
  const res  = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${longLivedUserToken}`);
  const data = await res.json();
  if (data.error) throw new Error(`FB page accounts failed: ${data.error.message}`);
  // Each entry already has a long-lived Page Access Token
  return data.data; // [{ id, name, access_token, category, ... }]
}

async function savePageToken(userId, pageId, pageName, pageAccessToken) {
  const encrypted = encrypt(pageAccessToken);
  await pool.query(
    `INSERT INTO facebook_pages (user_id, page_id, page_name, page_access_token_encrypted, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (page_id) DO UPDATE
       SET page_name = EXCLUDED.page_name,
           page_access_token_encrypted = EXCLUDED.page_access_token_encrypted,
           is_active = true`,
    [userId, pageId, pageName, encrypted]
  );
}

module.exports = { generatePKCE, buildLoginURL, exchangeCodeForUserToken, getLongLivedUserToken, getPageTokens, savePageToken };
