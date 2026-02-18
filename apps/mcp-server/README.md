# Kiwoom MCP Server

MCP server exposing Kiwoom proxy tools for ChatGPT Enterprise (Streamable HTTP).

## Setup

1. Start backend API (`apps/backend`) with Kiwoom credentials configured.
2. Configure env for MCP server:

```
MCP_PORT=8787
MCP_HOST=0.0.0.0
# MCP_ALLOWED_HOSTS=localhost,127.0.0.1
KIWOOM_PROXY_BASE_URL=http://localhost:4000
KIWOOM_PROXY_TIMEOUT_MS=15000
KIWOOM_PROXY_STREAM_URL=http://localhost:4000/api/kiwoom/realtime/stream
```

3. Run MCP server:

```
npm -w apps/mcp-server run dev
```

## MCP Endpoint

Streamable HTTP endpoint:

```
POST/GET/DELETE http://localhost:8787/mcp
```

## Tools

- `kiwoom_quote`
- `kiwoom_daily_close`
- `kiwoom_quotes`
- `kiwoom_account_summary`
- `kiwoom_holdings`
- `kiwoom_condition_list`
- `kiwoom_condition_search`
- `kiwoom_condition_search_and_quotes`
- `kiwoom_top_trading_value`
- `kiwoom_top_trading_volume`
- `kiwoom_realtime_register`
- `kiwoom_realtime_signal`
- `kiwoom_realtime_signals`

## Realtime Condition Stream

The MCP server listens to backend SSE and forwards condition-search realtime events as MCP log messages.

- Endpoint: `/api/kiwoom/realtime/stream`
- Requires condition search with `searchType=1` and successful realtime registration.

## Notes

- Account endpoints proxy the backend's portfolio state and holdings (virtual/real mode).
- Condition search uses Kiwoom websocket (`CNSRLST`/`CNSRREQ`). If `searchType=1`, matched symbols are automatically registered for realtime updates (0B/0D).
- Realtime signals rely on websocket cache, so register realtime before reading signals.
