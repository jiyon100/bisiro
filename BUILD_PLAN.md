# Bisiro — Build Plan

This is the execution plan for building Bisiro. It's meant to be worked through in order — each phase should end in something *runnable and testable* before moving to the next. Don't skip ahead even if a later phase seems more interesting; the AI logic in Phase 1 is the hardest part to get right and everything else depends on it being solid.

**Before starting:** read `CLAUDE.md` and `docs/PROJECT_SPEC.md`. They contain the exact numbers, formulas, and constraints referenced below (section numbers like "§4" refer to PROJECT_SPEC.md).

**Working style for each phase:**
- Check off tasks as you complete them (edit this file directly).
- After finishing a phase, run/demonstrate the "Definition of done" before moving on.
- Commit to git at the end of each phase with a message like `Phase 0: scaffold + schema`.
- If something in PROJECT_SPEC.md seems wrong, outdated, or you need to deviate from it, say so explicitly rather than silently changing it.

---

## Phase 0 — Project Scaffold & Database

**Goal:** A running Express server connected to Postgres, with the full schema in place.

- [x] `npm init`, install: `express`, `pg`, `dotenv`, `@anthropic-ai/sdk`, `cors`, `nodemon` (dev)
- [x] Folder structure:
  ```
  src/
    server.js
    db/
      pool.js
    routes/
    services/
    ai/
  migrations/
  public/
  scripts/
  ```
- [x] `src/db/pool.js` — exports a `pg.Pool` configured from `DATABASE_URL`
- [x] `src/server.js` — Express app with `express.json()`, CORS, and `GET /health` returning `{ status: "ok", db: <true/false> }` (db check = simple `SELECT 1`)
- [x] `migrations/` — one SQL file per table from PROJECT_SPEC §4: `users`, `facebook_pages`, `agent_configs`, `reply_logs`, `credit_transactions`, `pricing_config`, `conversations`, `conversation_messages`, `admin_users`. Use the exact columns listed there.
- [x] Migration runner: `npm run migrate` applies all SQL files in order (a simple script is fine — doesn't need a full framework like Knex unless you prefer one)
- [x] Seed `pricing_config` with initial rows: `markup_multiplier=2.9`, `usd_to_php_rate` (use a reasonable current rate, e.g. ~58), Haiku/Sonnet input/output token prices per PROJECT_SPEC §3
- [x] `.env` created from `.env.example` with local Postgres credentials (or Replit's Postgres add-on connection string)

**Definition of done:** `npm run dev` starts the server, `npm run migrate` creates all 9 tables with no errors, `GET /health` returns `{ status: "ok", db: true }`, and `SELECT * FROM pricing_config` shows the seeded values.

**Local dev setup notes (Windows):**
- Allow npm scripts once: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` (admin PowerShell)
- Start postgres each session: `& "C:\Program Files\PostgreSQL\17\bin\pg_ctl" -D "C:\Users\Jiyon\pgdata" -o "-p 5433" -l "C:\Users\Jiyon\pgdata\pg.log" start`
- Postgres runs on port 5433 (5432 is the system service). DATABASE_URL in .env already points there.

---

## Phase 1 — AI Prompt Module & Reply Engine

**Goal:** A standalone, testable module that takes a business config + conversation + new message and returns a correctly-formatted AI reply with cost calculation. **No Facebook code yet** — this is tested with hardcoded sample data.

- [x] `src/ai/platformPrompt.js` — exports the Platform Base Prompt text (trust/fairness rules, language rules incl. silent Cebuano/Ilocano→Taglish fallback, and the structured-output instruction) per PROJECT_SPEC §6
- [x] `src/ai/promptBuilder.js` — function `buildPrompt(businessPrompt, conversationHistory, newMessage)` that assembles Platform Base Prompt + Business-Specific Prompt + recent conversation turns + new message into the final message array for the Anthropic API
- [x] `src/ai/client.js` — thin wrapper around `@anthropic-ai/sdk`:
  - `generateReply(messages)` → calls Haiku 4.5 (`claude-haiku-4-5-20251001`), expects JSON response, parses `{ reply, status }`
  - `generateBusinessPrompt(wizardAnswers)` → calls Sonnet, used later in Phase 3
  - Both functions return token usage (input/output counts) alongside the result
- [x] `src/ai/costCalculator.js` — function `calculateCostPhp(inputTokens, outputTokens, model)` that reads `pricing_config` and applies the formula in PROJECT_SPEC §2 (`cost_usd × usd_to_php_rate × 2.9`)
- [x] `src/ai/replyEngine.js` — ties it together: `getReply(agentConfig, conversationHistory, newMessage)` → `{ reply, status, cost_php, input_tokens, output_tokens }`
- [x] `scripts/test-reply.js` — a runnable script with 3-4 hardcoded sample business configs (e.g. a sari-sari store, a home bakery) and sample customer messages in English, Tagalog, and Taglish. Print the AI's reply, status, and cost for each.

**Definition of done:** `node scripts/test-reply.js` runs against the real Anthropic API and prints sensible `{reply, status, cost_php}` for each sample — replies are in-character for the business, status classification looks correct (try one message that should clearly be `"closing"` and one that's an obvious repeated-spam pattern that should be `"spam"`), and the PHP cost numbers are in the expected ~₱0.40–0.50 per reply range.

---

## Phase 2 — Facebook OAuth & Webhook Receiver

**Goal:** A business owner can connect their Facebook Page, and the server receives and logs comment/DM events from it. Replies aren't sent yet — just received and logged, so the integration can be verified independently of the AI logic.

- [x] `src/services/facebookAuth.js` — implements the OIDC + PKCE flow from PROJECT_SPEC §5: generate `code_verifier`/`code_challenge`, build the Facebook login URL, exchange the returned `code` for tokens, exchange up to a long-lived Page Access Token
- [x] Routes: `GET /auth/facebook/start` (redirect to Facebook), `GET /auth/facebook/callback` (handle the redirect, store the Page Access Token — encrypted — in `facebook_pages`)
- [x] `GET /webhooks/facebook` — webhook verification (echoes `hub.challenge` if `hub.verify_token` matches `FB_VERIFY_TOKEN`)
- [x] `POST /webhooks/facebook` — webhook receiver:
  - Parse comment and `messaging` (DM) events
  - Detect `message_echo` events (owner replied via native FB inbox) and log them separately — this is the human-handoff trigger from PROJECT_SPEC §7, even though the pause logic itself comes in a later phase
  - For now: just write each incoming event to `conversation_messages` (creating a `conversations` row if one doesn't exist for that customer)
- [x] Implement reactive token handling: if any Graph API call returns error code 190, set `facebook_pages.is_active = false`
- [x] Implement the 550/hour-per-page rate tracking as a simple counter (table or in-memory + DB flush) — doesn't need to block anything yet, just track and log when it would be exceeded

**Definition of done:** Using a real test Facebook Page and app (in Development Mode — Advanced Access not needed yet for testing your own Page), connecting via `/auth/facebook/start` successfully stores a Page Access Token, and posting a comment / sending a Messenger message to the test Page results in a new row appearing in `conversation_messages`.

---

## Phase 3 — Setup Wizard ("AI Calibration")

**Goal:** A new business can answer the 9 wizard questions (PROJECT_SPEC §6) and get a working, custom `agent_config` they can test before going live.

- [x] Frontend: simple multi-step form (`public/wizard.html` + vanilla JS) covering the 9 questions — business info, customers, tone, top FAQs, things to never say, escalation behavior, hours, languages, and a textarea for pasting 3-5 real sample messages
- [x] `POST /api/wizard/generate` — takes the wizard answers, calls `generateBusinessPrompt()` (Sonnet, from Phase 1's `client.js`), stores the result in `agent_configs`
- [x] `POST /api/wizard/preview` — "test your bot": takes a sample message + the just-generated `agent_config`, runs it through `replyEngine.getReply()` (no DB writes, no Facebook), returns the reply for the owner to review
- [x] Owner can edit the generated prompt text directly before saving (simple textarea is fine)

**Definition of done:** Completing the wizard for a sample business produces an `agent_configs` row with a coherent, business-specific system prompt, and the "test your bot" preview returns realistic replies that reflect the wizard answers (correct tone, mentions the right products, follows the "never say" rules).

---

## Phase 4 — Credit System & PayMongo

**Goal:** Businesses can pay the setup fee and top up credits; replies deduct from balance; automation pauses at ₱0.

- [x] `src/services/paymongo.js` — wrapper for creating Checkout Sessions (setup fee = ₱20,000 flat; top-up = owner-entered amount, min ₱500 per PROJECT_SPEC §2/§8)
- [x] `POST /api/payments/topup` + `POST /api/payments/setup-fee` — creates PayMongo Checkout Session, returns redirect URL. PLACEHOLDER: needs real PAYMONGO_SECRET_KEY (sandbox) from PayMongo dashboard after business registration.
- [x] `POST /webhooks/paymongo` — verifies webhook signature, on successful payment writes `credit_transactions` row and updates `users.credit_balance_php`; setup fee also sets `setup_fee_paid = true` and `is_active = true`. PLACEHOLDER: PAYMONGO_WEBHOOK_SECRET needed (register webhook URL in PayMongo dashboard).
- [x] Wire `replyEngine` output into the live reply path (Facebook webhook handler): checks `credit_balance_php > 0`, generates AI reply, deducts `cost_php`, writes `credit_transactions` + `reply_logs`. PLACEHOLDER: actual Graph API send (`sendFacebookReply`) is stubbed — needs real page access token decryption once FB credentials are live.
- [x] Auto-pause: balance hits ₱0 → `users.is_active = false` + 'automation_paused' notification. Reactivates automatically on next top-up.
- [x] Low-balance check: balance < ₱50 → 'low_balance' notification (max once per 24h). notifications table added in migration 013.

**Definition of done:** In PayMongo sandbox mode, completing a ₱500 top-up checkout correctly increases `credit_balance_php` by 500 (minus nothing — the fee is absorbed in the 2.9x markup, not deducted here). Sending a test message through the full pipeline (Phase 2 webhook → Phase 1 reply engine) correctly deducts the calculated `cost_php` from the balance and logs both `reply_logs` and `credit_transactions` rows.

---

## Phase 5 — Dashboard & Messenger-Style Messages UI

**Goal:** The owner-facing UI described in PROJECT_SPEC §9 — dashboard with account credit and metrics, and a split-view Messages interface.

- [x] `public/dashboard.html` — top bar with total account credit + page switcher tabs; metric cards (replies today, active conversations, needs attention); "Needs your attention" alerts section; recent conversations list; notification bell
- [x] `public/messages.html` — split view: left pane = conversation list with status dots (amber=follow-up, blue=closing, green=automated), filter tabs (All / Attention / Automated), search; right pane = thread view with color-coded message bubbles (gray=customer, blue=AI, green=owner) and contextual banner
- [x] Backend endpoints: `GET /api/conversations` (list with status+filter), `GET /api/conversations/:id` (thread), `POST /api/conversations/:id/take-over`, `POST /api/conversations/:id/resume-ai`, `GET /api/conversations/stats/summary`, `GET /api/conversations/pages/list`, `GET /api/conversations/notifications/list`
- [x] Handoff state machine: `ai_paused` + `pause_type`, triggered by "Take over" click or `message_echo`; 30-min auto-resume for `complete`, 24hr safety-net notification for `pending` — runs via `setInterval` in server.js
- [x] Post-conversation auto-tagging: when a conversation is marked ended, fire one extra Haiku classification call to set `outcome_tag`

**Definition of done:** The dashboard shows live data from the database (not mocked). A real conversation can be viewed in the Messages split view, "Take over" correctly pauses AI for that conversation, and replying as the owner (simulated via the API, or via a real `message_echo` if Facebook is connected) triggers the resume-timer logic.

---

## Phase 6 — Admin Panel

**Goal:** A simple internal panel for managing the platform itself.

- [x] `public/admin.html` (separate, simple auth — `admin_users` table from §4) with:
  - Editable `pricing_config` (markup multiplier, USD/PHP rate, token prices) — changes apply immediately to new replies
  - `reply_logs` viewer with filters (by business, date range)
  - Manual payment approval fallback (in case a PayMongo webhook is missed) — view pending setup fees / top-ups and mark as paid manually

**Definition of done:** Changing `markup_multiplier` in the admin panel changes the `cost_php` calculated for the next test reply (verify by re-running Phase 1's test script or a live reply).

---

## After Phase 6 — Not in this plan yet

These are real, but deliberately out of scope until the above works end-to-end: Facebook App Review submission (needs a working demo of the above), business registration / DPO formalities (legal track, runs in parallel — see PROJECT_SPEC §10), Hetzner migration (see `hetzner-server-setup.sh` — only once Replit-based development is stable), Instagram/WhatsApp expansion (PROJECT_SPEC §11/Future Plans).

---

## Suggested first message to Claude Code

> Read `CLAUDE.md` and `docs/PROJECT_SPEC.md`, then start on Phase 0 of `BUILD_PLAN.md`. Work through the tasks in order, check them off in this file as you go, and tell me when Phase 0's "Definition of done" is met and how I can verify it myself.
