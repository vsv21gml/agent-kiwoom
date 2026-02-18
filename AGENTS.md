# Agent-Kiwoom Development Guide

## Product Goal
Build a Node.js 24 monorepo investment agent using:
- Backend: NestJS
- Frontend: Next.js (App Router)
- UI: Mantine
- State: Zustand
- Monorepo orchestrator: Turborepo

The system uses Kiwoom REST API market/account data, Gemini Flash model inference, and news scraping to continuously improve and execute strategy.

## Core Functional Requirements
1. Collect stock market data on a fixed cycle (default: 10 minutes).
2. Compare latest market data with current holdings and strategy.
3. Create buy/sell/hold decisions and execute the plan.
4. Support `virtual investment mode`:
   - Uses real market/news/LLM signals.
   - Does not place real orders.
   - Has configurable initial capital (default: KRW 1,000,000).
5. Scrape latest news on a fixed cycle (default: 1 hour).
6. Continuously refine strategy rules and write them into a file editable by user.
7. Initial strategy baseline: short-term trading.

## Monitoring UI Requirements
Provide paginated monitoring pages for:
1. Kiwoom REST API call logs
   - full request/response payloads
2. News scrape logs
3. Trade logs
   - timestamped buy/sell actions
   - realized/unrealized PnL view
4. Asset monitoring
   - time-series asset value chart
   - holdings + buy price + current value + cash summary

## Engineering Rules
- Runtime target: Node.js 24.
- Keep backend scheduler intervals configurable via env.
- Log every external call (Kiwoom, news sources, Gemini where applicable).
- Use a persistent DB (PostgreSQL via Prisma).
- Keep strategy file as markdown text, versionable and manually editable.
- Never place real order when virtual mode is enabled.
- Expose all monitoring data via backend REST API with pagination.

## Security / Secrets
- Use environment variables for all credentials.
- `GEMINI_API_KEY` is expected in runtime env.
- Never commit real secrets.

## Default Config
- `VIRTUAL_TRADING_MODE=true`
- `INITIAL_CAPITAL=1000000`
- `MARKET_POLL_CRON=*/10 * * * *`
- `NEWS_SCRAPE_CRON=0 * * * *`
- `GEMINI_MODEL=gemini-3.0-flash`

## Delivery Scope for Initial Build
- Functional monorepo skeleton.
- Working NestJS scheduler + DB + REST APIs.
- Working Next.js monitoring dashboard with pagination.
- Strategy markdown file + auto-update pipeline.
- Safe virtual trading execution path as default.

