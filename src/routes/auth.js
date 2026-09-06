const express = require('express');
const crypto  = require('crypto');
const { generatePKCE, buildLoginURL, exchangeCodeForUserToken, getLongLivedUserToken, getPageTokens, savePageToken } = require('../services/facebookAuth');

const router = express.Router();

// GET /auth/facebook/start
// Redirects the business owner to Facebook's login dialog.
// Requires: req.session.userId set by auth middleware (added in later phase).
// For now accepts ?user_id= query param for testing.
router.get('/facebook/start', (req, res) => {
  const userId = req.session.userId || req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'Not logged in' });

  const { verifier, challenge } = generatePKCE();
  const state = crypto.randomBytes(16).toString('hex');

  // Store verifier + userId in session for the callback
  req.session.pkce = { verifier, state, userId };

  res.redirect(buildLoginURL(challenge, state));
});

// GET /auth/facebook/callback
// Facebook redirects here after the owner approves.
router.get('/facebook/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.status(400).send(`Facebook login cancelled: ${error}`);

  const pkce = req.session.pkce;
  if (!pkce || pkce.state !== state) return res.status(400).send('Invalid state — possible CSRF. Please try again.');

  try {
    const shortToken    = await exchangeCodeForUserToken(code, pkce.verifier);
    const longUserToken = await getLongLivedUserToken(shortToken);
    const pages         = await getPageTokens(longUserToken);

    for (const page of pages) {
      await savePageToken(pkce.userId, page.id, page.name, page.access_token);
    }

    delete req.session.pkce;
    res.redirect('/connect-page.html?connected=' + pages.length);
  } catch (err) {
    console.error('Facebook callback error:', err.message);
    res.redirect('/connect-page.html?error=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
