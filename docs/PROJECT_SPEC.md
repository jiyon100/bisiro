# Bisiro — Technical & Business Specification
**Facebook AI Automation SaaS for Filipino Small Businesses**

*This document consolidates every architectural, business, legal, and design decision made during planning. Claude Code: read this before starting any new feature area — it contains the exact numbers, formulas, and constraints this project depends on.*

---

## 1. Product Overview

Bisiro is a prepaid, AI-powered automation platform that lets Filipino small business owners connect their Facebook Page and automatically respond to customer **comments**, **direct messages (Messenger)**, or **both**, using AI tailored to their specific business through a guided setup wizard.

**Target users:** Small businesses (starting with friends/family pilots, expanding to general SMBs).

**Core value proposition vs. competitors (ManyChat, Chatfuel):**
- PHP-native prepaid credits (no USD subscriptions)
- AI-guided setup wizard generates the agent's behavior — no manual "flow building"
- No monthly subscription — load credits, use platform, never expire into a paywall

---

## 2. Business Model & Pricing

### One-Time Setup Fee
- **₱20,000** charged at registration, paid via PayMongo Checkout
- Account is inactive until this is paid

### Prepaid Credit System
- No monthly subscriptions — users **load credits (PHP)** and the system deducts per AI reply
- **Minimum top-up: ₱500**
- If balance hits ₱0, automation pauses automatically
- Low-balance warning sent when balance < ₱50

### Pricing Formula
```
cost_to_client_php = anthropic_api_cost_usd × usd_to_php_rate × markup_multiplier
```
- **Markup multiplier: 2.9x** (originally 2.8x; the extra 0.3x absorbs PayMongo's ~3% GCash transaction fee so the client never sees it as a separate line item)
- All values (`markup_multiplier`, `usd_to_php_rate`, token prices) stored in a `pricing_config` table, editable by admin — recalculates automatically if Anthropic changes prices

### Subscription Tiers (volume-based)

| Tier | Monthly Reply Limit | Features |
|---|---|---|
| Starter | 500 replies/month | DM automation only |
| Growth | 2,000 replies/month | DM + Comment automation |
| Pro | 10,000 replies/month | DM + Comment + priority support, push/SMS alerts |

### Real Cost Example (Haiku 4.5)
- ~200 input + ~500 output tokens per reply ≈ **$0.0027** raw cost
- At 2.9x markup ≈ **$0.0078 ≈ ₱0.45 per reply**
- Starter tier (500 replies/month) ≈ **₱225/month** underlying AI cost — healthy margin even at the cheapest tier

---

## 3. Tech Stack & Hosting

| Layer | Choice |
|---|---|
| Backend | Node.js + Express |
| Frontend | HTML / CSS (Tailwind CDN) / Vanilla JS |
| Database | PostgreSQL (self-hosted on the same VPS) |
| AI Provider | Anthropic Claude API |
| Payments | PayMongo (GCash, Maya, cards, OTC) |
| Hosting | Hetzner (development on Replit, production migrates to Hetzner) |

### Database connection
Always connect via a single `DATABASE_URL` environment variable. This is the standard Postgres connection-string format — Replit's Postgres add-on provides one, and Hetzner's self-hosted Postgres will too. The application code never needs to change between environments, only the `.env` value.

### Hetzner Setup (MVP → ~10,000 users)

| Item | Monthly Cost |
|---|---|
| CX22 VPS (2 vCPU / 4GB RAM) | ~$8 |
| PostgreSQL | Self-hosted on the same box — **$0** (vs. ~$15/mo managed) |
| **Total** | **~$8–12 (~₱450–700)** |

- Provisioned via `hetzner-server-setup.sh` (in project root): installs Node.js LTS, sets up self-hosted PostgreSQL + DB/user, configures UFW firewall, PM2 (process manager), Nginx reverse proxy, free Let's Encrypt SSL, and automated daily `pg_dump` backups (2 AM cron, 14-day retention).
- Individual signup is fine (personal government ID, no business permit needed at this stage). Choose a Singapore datacenter for lower latency to the Philippines if available.
- **Scaling path:** resizing is cheap and fast on Hetzner — no need to over-provision early. At ~100,000-business scale, a CCX33 (8 dedicated vCPU / 32GB) ≈ $68/mo + ~1TB storage volume ≈ $50/mo ≈ **~$118/mo (~₱6,700)** — a planning figure only, not something to provision now.
- **The real long-term scaling constraint is conversation-data storage** (~25–50MB/year per business → 2.5–5TB/year at 100k businesses), not CPU. Plan storage volume upgrades around this, not server size.

### Development Environment
- **Build and iterate on Replit** (public URL out of the box — useful for Facebook OAuth/webhook testing during development; familiar tooling).
- **Do not depend on Replit-specific features** (its built-in DB, auth, secrets UI beyond basic env vars) — everything must work via standard `DATABASE_URL` / `.env` so migrating to Hetzner is just `git clone` + `.env` + `pm2 start`, not a rebuild.
- Source of truth = a GitHub repo. Replit imports from / pushes to it; Hetzner deploys from it.

### Claude Model Selection

| Task | Model | Price (per 1M tokens) | Rationale |
|---|---|---|---|
| Live customer replies (Agent AI) | **Haiku 4.5** (`claude-haiku-4-5-20251001`) | $1 in / $5 out | Cheapest, fast, ideal for classification + short conversational replies |
| Setup AI (onboarding wizard) | **Sonnet 4.6** | $3 in / $15 out | One-time per business — quality matters more than cost here |
| Spam flagging, status classification, conversation tagging | **Haiku 4.5** | $1 in / $5 out | Same lightweight classification pattern |

**Cost lever:** Implement prompt caching — each business's system prompt is reused across every reply; caching cuts repeated input costs by up to 90%.

---

## 4. Database Schema

```sql
-- Business accounts (1 per business owner)
users (
  id, email, password_hash, business_name, business_type,
  tier, credit_balance_php, setup_fee_paid, is_active,
  created_at, updated_at
)

-- Connected Facebook Pages (1 user can have multiple)
facebook_pages (
  id, user_id, page_id, page_name, page_access_token_encrypted,
  automate_comments, automate_dms, business_hours_json,
  is_active, connected_at
)

-- AI agent configuration per page/business (generated by Setup AI)
agent_configs (
  id, user_id, system_prompt, business_context,
  tone, language_preference, sample_messages,
  created_at, updated_at
)

-- Per-reply usage logs
reply_logs (
  id, user_id, facebook_page_id, reply_type (comment/dm),
  input_tokens, output_tokens, cost_usd, cost_php,
  message_preview, replied_at
)

-- Credit ledger
credit_transactions (
  id, user_id, type (topup/deduction),
  amount_php, description, created_at
)

-- Admin-controlled pricing
pricing_config (
  id, key, value, updated_at
  -- keys: input_price_per_token_usd, output_price_per_token_usd,
  --       usd_to_php_rate, markup_multiplier (2.9)
)

-- Conversation threads (NEW — powers memory, handoff, CRM)
conversations (
  id, user_id, facebook_page_id, customer_psid, customer_name,
  ai_paused (bool), pause_type (complete/pending/null),
  pause_started_at, status (ongoing/closing/spam/ended),
  outcome_tag (closed_sale/follow_up/not_interested/custom/null),
  last_message_at, created_at
)

-- Individual messages within a conversation
conversation_messages (
  id, conversation_id, sender (customer/ai/owner),
  content, sent_at
)

-- Admin users
admin_users (
  id, email, password_hash, created_at
)
```

**Rate limiting:** Tracked per `facebook_pages.id` (not per user) — hard cap of **550 replies/hour per page**, queued if exceeded.

---

## 5. Facebook / Meta Integration

### OAuth Flow (Custom Backend — No SDK)
Use **OIDC Code Flow with PKCE** + **"Facebook Login for Business"** configuration:
1. Generate `code_verifier` + `code_challenge` server-side
2. Redirect business owner to Facebook's login dialog
3. Facebook redirects back with authorization `code`
4. Server exchanges `code` → short-lived **User Access Token**
5. Exchange User Token → long-lived User Token (~60 days)
6. Exchange long-lived User Token → **long-lived Page Access Token** (no fixed expiry)

### Token Management
- **Page Access Tokens do not expire on a schedule** — only invalidated by: password change, app permission revocation, admin removal, or Meta security review
- **No cron-based refresh needed.** Instead: reactive reconnect —
  - On Graph API error code 190 (invalid token) → set `facebook_pages.is_active = false`
  - Notify owner: "Reconnect your Facebook Page" → re-run OAuth flow
- **Security:** Page tokens encrypted at rest in DB; never hardcoded; `.gitignore` for all secrets (GitHub scans public repos for exposed Meta tokens and auto-invalidates them)

### Rate Limits & Messaging Rules
- Meta limit: 750/hour for post-comment private replies → **platform cap set at 550/hour per page** (~27% safety buffer)
- Exceeding cap → excess replies **queued**, sent in next window; owner notified positively ("high engagement!")
- **24-hour messaging window** for DMs — AI can only respond if customer messaged within last 24 hours
- **Comment-to-DM:** max 1 automated DM per comment, within 7 days of the comment

### Required Permissions & App Review
- `pages_manage_engagement` (comment replies), `pages_messaging` (DMs), `pages_read_engagement`, `pages_read_user_content`, `pages_manage_metadata`
- These require **Advanced Access** via Meta App Review (apps default to Standard Access = own pages only)
- **Process:** build working MVP with your own test Page → create test Facebook account/Page → record screen demo for each permission → submit for review
- **Timeline:** 1-5 business days per review cycle, but budget **2-4 weeks** for 2-3 cycles (first submissions often need revision)
- **Cost:** Free — but you cannot onboard real clients until Advanced Access is approved
- **Interim plan:** soft-launch with 1-2 friendly pilot businesses using your test Page access while awaiting approval

---

## 6. AI System Architecture

### Two AI Roles
1. **Setup AI** (Sonnet 4.6) — runs during onboarding, interviews the business owner, generates a custom system prompt
2. **Agent AI** (Haiku 4.5) — runs live, replies to customers using that system prompt + conversation history

### Two-Layer Prompt Structure
Every reply is generated from: **Platform Base Prompt + Business-Specific Prompt + conversation context**

**Platform Base Prompt (identical for all businesses, editable platform-wide):**
- *Trust & fairness:* "Your primary goal is to genuinely help the customer — recommend only what fits their need, never use pressure or misleading claims. If the business's offerings don't fit, say so honestly."
- *Language:* "Respond only in English or Tagalog/Taglish, matching the customer's tone and formality (po/opo). If a customer writes in Cebuano, Ilocano, or another dialect, respond in Tagalog/Taglish instead — handle naturally without commenting on the switch." (Silent fallback — no flag to owner.)
- *Status classification:* every reply returns structured output — `{"reply": "...", "status": "ongoing" | "closing" | "spam"}`

**Business-Specific Prompt (generated by Setup AI from wizard answers):**
- Business name/offerings, target customers, tone, business hours, top FAQs, things to never say, escalation behavior, real sample customer messages for calibration

### AI Calibration Wizard — Onboarding Questions
1. Business name and what you sell/offer
2. Typical customers (students, families, professionals, etc.)
3. Tone preference (friendly/casual, professional, playful, formal)
4. Top 3 customer questions
5. Things the AI should NEVER say/promise (exact prices, delivery dates, etc.)
6. What should the AI do if it can't answer (escalate to owner)
7. Business operating hours (required — determines after-hours behavior)
8. Languages customers use (English / Tagalog / Taglish — scoped to these two)
9. **Paste 3-5 real customer messages** — Setup AI uses these to calibrate tone/slang/formality directly

Generated prompt is shown to owner for review/edit, then a **"test your bot"** preview lets them try sample messages before going live.

---

## 7. Conversation Automation Logic

### Autopilot → Status Detection → Action

Every customer message triggers: AI generates reply + classifies status →
- **`ongoing`** → send reply, save to history, continue autopilot (green "Automated" state — no owner action needed)
- **`closing`** → send reply (still helpful!) AND notify owner: "Take over" or "Let AI continue" (blue "Closing — review" state)
- **`spam`** → skip full reply generation (cost savings), optionally flag for owner

### Spam / Abuse Guardrails (content-based, not volume-based)
1. **Debouncing:** wait a few seconds after a message before replying, batching rapid multi-message sends into one coherent reply (also neutralizes message floods)
2. **Content classification:** spam = repeated identical content, not high message frequency (a genuinely interested customer often sends many short messages — that's normal, not abuse)
3. **Soft cost-alert:** if one conversation's daily AI spend crosses ~₱30-50, notify owner rather than auto-blocking
4. **Owner-initiated blocklist only** — no automatic blocking; owner reviews and blocks manually from dashboard

### Human Handoff System
- Each conversation has `ai_paused` (bool) + `pause_type` (`complete` / `pending`)
- **Pause triggers:**
  - Owner clicks "Take over" from a notification
  - System detects a `message_echo` webhook event (owner replied via their normal Facebook Page Inbox) — AI pauses automatically, no extra app needed
- **Resume logic — two-tier, based on classifying the owner's reply (1 extra Haiku call):**
  - **Complete answer** (e.g., "Yes po, ₱500, may stock") → standard **30-minute auto-resume timer**
  - **Pending/checking** (e.g., "Sandali po, tinitignan ko") → AI stays paused indefinitely; **24-hour safety net** re-notifies owner if they haven't followed up: *"[Customer] is still waiting on the info you said you'd check yesterday"*
- Dashboard shows live status badge per conversation: Automated / Follow-up due / Closing — review / You're handling this

### Conversation Memory & Data Privacy
- Full conversation history stored in `conversations` / `conversation_messages` tables, logically isolated per `business_id` (not physically separate databases)
- Storage is negligible: ~25-50MB/year even for a busy SMB
- **"Memory" = context injection, not model retraining** — past messages are included in the prompt context; Claude does not retrain on this data
- **Meta compliance:** AI operates within Bisiro's own infrastructure, acts on behalf of the business, never shares/trains on data externally — matches Meta's accepted pattern for third-party AI on messaging platforms
- **Post-conversation auto-tagging** (1 extra Haiku call when conversation ends): `closed_sale` / `follow_up` / `not_interested` / custom — becomes lightweight CRM data for the owner

---

## 8. Payment System (PayMongo)

- **GCash, Maya, cards, OTC (7-Eleven, Cebuana)** supported
- ~3% fee on e-wallet transactions — **absorbed into the 2.9x markup**, never shown as a separate line item to the client
- **Checkout API + webhook:** business creates a Checkout Session for top-up amount → redirected to PayMongo's hosted page → webhook confirms payment → `credit_balance_php` auto-updated (no manual admin approval needed)
- Same flow used for the ₱20,000 setup fee (its ~₱600 PayMongo fee is absorbed as a one-time cost of doing business)
- **Account activation requires:** DTI/SEC registration + BIR Certificate of Registration + valid government ID — this is the trigger for needing business registration

---

## 9. User Interface Design

### Dashboard (top of every page)
- **Total account credit** (shared across all connected pages — prominent, top-left)
- **Page switcher** (tabs: e.g. "Main Branch" / "Mall Branch" / "+ Add page") — switching changes page name, automation status, and stats below, but credit balance stays constant (it's account-wide)
- Page header: page name, automation status (live/Messenger+Comments), Settings button
- Metric cards: Replies today, Active conversations, **Reply rate this hour (X / 550)** — live visibility into the rate-limit safety buffer

### "Needs Your Attention" Alerts
- Amber card (Follow-up due): "[Customer] is still waiting — you said you'd check X hours ago" → Open conversation
- Blue card (Closing — review): "[Customer] seems ready to order — AI sent a closing reply" → Take over / Let AI continue

### Messages — Messenger-Style Split View
- **Left pane:** compact conversation list — avatar + status dot (amber=follow-up, blue=closing, green=automated, gray=handling) + name + message preview
- **Right pane:** active conversation thread — header (name, channel, status badge), contextual banner, message bubbles, reply box
- **Filter tabs:** All / Needs attention / Automated

### Conversation Thread — Color Coding
- **Gray bubbles** = customer messages
- **Blue bubbles, labeled "AI"** = AI-generated replies
- **Green bubbles, labeled "You"** = owner's own replies (sent via dashboard or detected via Facebook Page Inbox)
- **Banners:** amber (AI paused, needs you) / blue (AI active, FYI) / green (AI handled it, no action needed)

---

## 10. Business Registration & Legal

### Entity Structure — Recommended: OPC (One Person Corporation)
- **Why not DTI sole proprietorship:** no direct conversion path to a corporation later — would require dissolving and restarting entirely (new TIN, permits, bank accounts, PayMongo account)
- **OPC → regular corporation** (when investors join) is a simple Articles of Incorporation amendment — no restart
- Requires a **Corporate Secretary who is NOT the sole stockholder** (can be a trusted family member/friend, formality role)
- Keep declared capital stock modest (₱5,000–50,000) to minimize the treasurer's surety bond

### Registration Cost & Timeline

| Item | Cost | Timeline |
|---|---|---|
| SEC registration (OPC) | ₱3,000–10,000 | 1 week (best case, eFAST) to 3 weeks |
| BIR registration (TIN, books, receipts) | ₱1,500–3,000 | +1-4 weeks |
| Mayor's Permit + Barangay Clearance | ₱2,000–8,000 | Varies by LGU |
| **Total (DIY)** | **~₱7,000–22,000** | **2-6 weeks realistic, ~4 weeks average** |
| (Optional) Registration service | +₱15,000–30,000 | Saves time/errors |

**Key point:** Registration does NOT block development — only blocks (1) live PayMongo payments and (2) possibly smoother Meta business verification. Can run in parallel with building the MVP.

### Data Privacy Act (RA 10173) Compliance
- Platform = **Personal Information Processor (PIP)**; each business client = **Personal Information Controller (PIC)** for their own customers' data — need a Data Processing Agreement between platform and each client
- **Designate a Data Protection Officer (DPO)** early — register via NPC Registration System (NPCRS), even at small scale
- **Mandatory full system registration** triggers at: 250+ employees OR processing sensitive personal data of 1,000+ individuals OR high-risk automated processing — likely not triggered at pilot stage but revisit as total end-customers across all clients approaches 1,000
- If exempt, submit notarized **Sworn Declaration (Annex 1)**
- **Annual Security Incident Report (ASIR)** due March 31 every year — required for ALL PICs/PIPs regardless of registration track, even with zero incidents

---

## 11. Funding Strategy

- **Realistic pre-money valuation at idea/pre-MVP stage:** $50,000–150,000 (₱2.85M–8.5M) — Philippines/SEA pre-seed norms, "pre-product" tier of the Stage Method
- **10% equity at this stage ≈ ₱285,000–855,000** (~$5,000–15,000)
- **"Multi-million dollar potential" framing:** investors price *current risk*, not future potential — each milestone (working MVP → Meta approval → paying pilot clients → MRR) multiplies valuation for future rounds
- **Strategy:** find one "anchor" investor, use a **SAFE with a valuation cap** (works pre-incorporation), structure as an open round with a total equity pool (e.g., 10-15% combined) rather than 10% per investor
- **Investment ≠ profit** — it's capital in exchange for equity (ownership %); investor returns come later via dividends (plausible here given early revenue) or appreciation/exit
- **Bootstrap-first sequence:** build MVP → onboard 3-5 pilot businesses → approach investors with real traction (stronger pitch + better valuation)

---

## 12. End-to-End Onboarding Flow

1. **Register** (email, business name, business type)
2. **Pay ₱20,000 setup fee** via PayMongo Checkout
3. **Connect Facebook Page** via OAuth (Facebook Login for Business)
4. **Choose automation type:** Comments / DMs / Both (tier-dependent)
5. **AI Calibration Wizard** (9 questions above) → Setup AI generates system prompt → owner reviews/edits → "test your bot" preview
6. **Top up credits** (min ₱500) via PayMongo
7. **Go live** — webhook receiver activates, Agent AI begins responding within rate limits and business hours

---

## 13. MVP Build Order (Recommended)

1. User registration + login + session management
2. Setup fee tracking via PayMongo Checkout
3. Facebook Page OAuth connection (PKCE flow)
4. Automation type selection
5. AI Calibration Wizard → system prompt generation + "test your bot"
6. Credit top-up via PayMongo webhook (auto-credit)
7. Facebook Webhook receiver + Agent AI reply engine (with rate limiting, 24hr window, debouncing)
8. Credit deduction per reply (2.9x markup formula)
9. Conversation memory, status classification, handoff (`ai_paused`), auto-tagging
10. Dashboard + Messenger-style Messages UI (per the interactive prototype)
11. Admin panel: pricing config, payment approvals (fallback), reply logs

---

## 14. Open Items / Next Steps

- [ ] Register OPC (can start in parallel with development)
- [ ] Apply for Facebook Developer App + begin App Review prep (test Page, demo recordings)
- [ ] Set up Replit project (development) + GitHub repo (source of truth)
- [ ] Provision Hetzner CX22 VPS, run `hetzner-server-setup.sh` (production target — set up early so Facebook webhook URL is stable)
- [ ] Set up Anthropic API account + billing
- [ ] Set up PayMongo account (sandbox first, then live after business registration)
- [ ] Designate DPO, draft Privacy Policy + Data Processing Agreement template
- [ ] Build MVP per build order above
- [ ] Soft-launch with 1-2 pilot businesses during Meta App Review wait period
- [ ] Begin investor conversations once pilot traction exists
