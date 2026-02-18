# Agent Kiwoom

Node 24 + Turbo monorepo for Kiwoom REST API + Gemini Flash based trading agent.

## Apps
- `apps/backend`: NestJS scheduler + Kiwoom/news/strategy/trading APIs
- `apps/web`: Next.js monitoring dashboard (Mantine + Zustand)

## Quick Start
```bash
docker compose up -d
npm install
copy apps/backend/.env.example apps/backend/.env
npm run dev
```

DB connection is configured with:
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- Optional SSL flags: `DB_SSL`/`SSL`, `DB_SSL_IGNORE`/`SSL_IGNORE`

- Backend: `http://localhost:4000/api`
- Frontend: `http://localhost:3000`

## Key Endpoints
- `GET /api/monitoring/api-calls`
- `GET /api/monitoring/news`
- `GET /api/monitoring/trades`
- `GET /api/monitoring/assets`

## Strategy File
- `apps/backend/data/INVESTMENT_STRATEGY.md`

Agent updates this markdown using news + Gemini and you can edit it manually.
