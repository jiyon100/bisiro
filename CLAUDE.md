# Bisiro — Project Memory

Bisiro is a prepaid, AI-powered automation SaaS for Filipino small businesses. It connects to a business's Facebook Page and uses Claude to auto-reply to comments, Messenger DMs, or both — in English/Tagalog/Taglish — based on a per-business AI configuration generated through a guided Setup Wizard.

**Status:** Pre-development. No application code exists yet. This file plus `docs/PROJECT_SPEC.md` are the starting context for building the MVP. Update the "Status" section as features land.

**Full specification:** `docs/PROJECT_SPEC.md` contains the complete schema, AI prompt architecture, Facebook integration rules, pricing math, and legal/funding context. Read the relevant section before starting any new feature area — most "obvious" defaults (rate limits, markup, tiers, wizard questions) have already been decided for specific reasons. Don't redesign them without flagging why.

## Tech stack (do not substitute without discussion)
- Backend: Node.js + Express
- Database: PostgreSQL — connect via `DATABASE_URL` env var only. Local dev uses port 5433 (`postgres://...@localhost:5433/bisiro`). Production target: Hetzner VPS (self-hosted Postgres).
- Frontend: vanilla HTML/CSS/JS, Tailwind via CDN is fine — no framework
- AI: Anthropic API — `claude-haiku-4-5-20251001` for live replies/classification, Sonnet for the Setup Wizard
- Payments: PayMongo (GCash, Maya, cards)
- Dev environment: Local Windows 11 machine, developed with Claude Code. For Facebook/PayMongo webhook testing locally, expose port 3000 via **ngrok** or **Cloudflare Tunnel** to get a public HTTPS URL. Production target: Hetzner VPS (`hetzner-server-setup.sh` in repo root).

## Environment & secrets
All config via `.env` (never committed): `DATABASE_URL`, `ANTHROPIC_API_KEY`, `FB_APP_ID`, `FB_APP_SECRET`, `FB_VERIFY_TOKEN`, `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`. Always add a matching placeholder to `.env.example` when introducing a new env var. `.env` and `.env.local` must be in `.gitignore` from the first commit (GitHub auto-revokes exposed Meta/Anthropic tokens, but don't rely on that).

## Core business rules (always apply — see PROJECT_SPEC §2)
- Pricing: `cost_to_client_php = anthropic_cost_usd × usd_to_php_rate × 2.9`. The `2.9` multiplier and `usd_to_php_rate` live in the `pricing_config` table — never hardcode them in application code.
- Setup fee: ₱20,000 one-time, paid before account activation. Prepaid credits: ₱500 minimum top-up, never expire, no subscription.
- Automation auto-pauses at ₱0 balance. Low-balance warning below ₱50.
- Facebook reply rate cap: **550/hour PER PAGE** (not per user/account) — hard limit, queue overflow rather than drop.
- Messenger 24-hour window applies to DM replies. Max 1 automated comment→DM per comment, within 7 days.

## AI prompt architecture (see PROJECT_SPEC §6)
Every live reply = Platform Base Prompt + Business-Specific Prompt (from Setup Wizard, Sonnet-generated) + conversation context → Haiku → structured JSON `{"reply": "...", "status": "ongoing" | "closing" | "spam"}`.
- Platform Base Prompt is global/versioned, lives in code or config — not duplicated per business.
- Keep prompt-assembly logic in its own module, decoupled from Express routes, so it's unit-testable with sample inputs before any Facebook integration exists.
- Spam classification is content-based (repeated identical messages), **never** volume-based — a real customer can legitimately send many quick messages.

## Conversation automation (see PROJECT_SPEC §7)
- Debounce incoming messages a few seconds before generating a reply (batches rapid multi-message sends into one coherent response).
- `status: "closing"` → still send the AI reply, but also surface it for owner review — don't block on it.
- Human handoff state lives on `conversations`: `ai_paused` (bool) + `pause_type` (`complete` | `pending` | null). Pause triggers: owner clicks "Take over" in dashboard, OR a `message_echo` webhook fires (owner replied via native FB inbox — no extra app needed to detect this).
- Resume logic (1 extra Haiku classification call on the owner's reply): `complete` → 30-min auto-resume timer; `pending` → indefinite pause + 24hr safety-net reminder to the owner.

## Database (full column definitions in PROJECT_SPEC §4)
Core tables: `users`, `facebook_pages`, `agent_configs`, `reply_logs`, `credit_transactions`, `pricing_config`, `conversations`, `conversation_messages`, `admin_users`. Use the schema as specified — flag it explicitly if you think a table needs to change shape, don't silently diverge.

## Build order (current priority — see PROJECT_SPEC §13 and BUILD_PLAN.md)
`BUILD_PLAN.md` is the detailed, checkbox-driven execution plan — work through its phases in order, checking off tasks as completed. The high-level sequence:
1. Project scaffold + Postgres schema/migrations
2. AI prompt module (Platform Base Prompt assembly + Anthropic API wrapper) — testable standalone with sample inputs, no Facebook needed
3. Facebook OAuth (PKCE) + webhook receiver
4. Setup Wizard (Sonnet-generated business prompt + "test your bot" preview)
5. Credit system + PayMongo integration
6. Dashboard + Messenger-style Messages UI
7. Admin panel (pricing config, reply logs, payment fallback)

## Conventions
- Reference the relevant PROJECT_SPEC.md section number in comments on non-obvious business logic, e.g. `// 2.9x markup — see PROJECT_SPEC.md §2`.
- When a number, formula, or rule seems off or you're tempted to guess at a default, check `docs/PROJECT_SPEC.md` first — then ask if it's still unclear.
