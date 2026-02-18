import express from "express";
import * as z from "zod/v4";
import { randomUUID } from "node:crypto";
import { EventSource } from "eventsource";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

const MCP_PORT = Number(process.env.MCP_PORT ?? "8787");
const MCP_HOST = process.env.MCP_HOST ?? "0.0.0.0";
const MCP_ALLOWED_HOSTS = process.env.MCP_ALLOWED_HOSTS;
const PROXY_BASE_URL = process.env.KIWOOM_PROXY_BASE_URL ?? "http://localhost:4000";
const PROXY_TIMEOUT_MS = Number(process.env.KIWOOM_PROXY_TIMEOUT_MS ?? "15000");
const PROXY_STREAM_URL =
  process.env.KIWOOM_PROXY_STREAM_URL ?? `${PROXY_BASE_URL.replace(/\/$/, "")}/api/kiwoom/realtime/stream`;

const buildUrl = (path: string) => {
  const base = PROXY_BASE_URL.replace(/\/$/, "");
  return `${base}${path}`;
};

const fetchJson = async (path: string, init?: RequestInit) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  const requestId = randomUUID();
  try {
    console.log(`[proxy:${requestId}] ${init?.method ?? "GET"} ${buildUrl(path)}`);
    const response = await fetch(buildUrl(path), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({}));
    console.log(`[proxy:${requestId}] status=${response.status} ok=${response.ok}`);
    if (!response.ok) {
      const message = typeof body?.message === "string" ? body.message : JSON.stringify(body);
      console.error(`[proxy:${requestId}] error=${message}`);
      throw new Error(`Proxy request failed (${response.status}): ${message}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
};

const createServer = () => {
  const server = new McpServer(
    {
      name: "kiwoom-mcp-server",
      version: "1.0.0",
      websiteUrl: "https://localhost",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  server.registerTool(
  "kiwoom_quote",
  {
    title: "Kiwoom Quote",
    description: "Fetch a single stock quote by symbol.",
    inputSchema: {
      symbol: z.string().describe("Stock symbol, e.g. 005930"),
    },
  },
  async ({ symbol }) => {
    const data = await fetchJson(`/api/kiwoom/quote?symbol=${encodeURIComponent(symbol)}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
  );

  server.registerTool(
  "kiwoom_daily_close",
  {
    title: "Kiwoom Daily Close",
    description: "Fetch latest daily close price by symbol.",
    inputSchema: {
      symbol: z.string().describe("Stock symbol, e.g. 005930"),
    },
  },
  async ({ symbol }) => {
    const data = await fetchJson(`/api/kiwoom/daily-close?symbol=${encodeURIComponent(symbol)}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
  );

  server.registerTool(
  "kiwoom_quotes",
  {
    title: "Kiwoom Quotes",
    description: "Fetch multiple stock quotes in one call.",
    inputSchema: {
      symbols: z.array(z.string()).describe("List of stock symbols"),
    },
  },
  async ({ symbols }) => {
    const data = await fetchJson("/api/kiwoom/quotes", {
      method: "POST",
      body: JSON.stringify({ symbols }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
  );

  server.registerTool(
  "kiwoom_account_summary",
  {
    title: "Kiwoom Account Summary",
    description: "Get account cash, holdings value, and total asset summary.",
    inputSchema: {},
  },
  async () => {
    const data = await fetchJson("/api/kiwoom/account");
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
  );

  server.registerTool(
  "kiwoom_holdings",
  {
    title: "Kiwoom Holdings",
    description: "List account holdings with price and PnL.",
    inputSchema: {},
  },
  async () => {
    const data = await fetchJson("/api/kiwoom/holdings");
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
  );

  server.registerTool(
  "kiwoom_condition_list",
  {
    title: "Kiwoom Condition List",
    description: "Get saved Kiwoom condition filters (조건검색 목록).",
    inputSchema: {},
  },
  async () => {
    const data = await fetchJson("/api/kiwoom/conditions");
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
  );

  server.registerTool(
  "kiwoom_top_trading_value",
  {
    title: "Kiwoom Top Trading Value",
    description: "Get top trading value list (거래대금 상위). Use marketType=0 for KOSPI, 10 for KOSDAQ.",
    inputSchema: {
      marketType: z.string().optional().describe("0: KOSPI, 10: KOSDAQ, 50: KONEX"),
      includeManaged: z.boolean().optional().describe("Include managed stocks"),
      stexTp: z.string().optional().describe("Exchange type, e.g. 1"),
    },
  },
  async ({ marketType, includeManaged, stexTp }) => {
    const query = new URLSearchParams();
    if (marketType) query.set("marketType", marketType);
    if (includeManaged !== undefined) query.set("includeManaged", String(includeManaged));
    if (stexTp) query.set("stexTp", stexTp);
    const data = await fetchJson(`/api/kiwoom/top-trading-value?${query.toString()}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
  );

  server.registerTool(
  "kiwoom_top_trading_volume",
  {
    title: "Kiwoom Top Trading Volume",
    description: "Get top trading volume list (거래량 상위). Use marketType=000 for all, 001 for KOSPI, 101 for KOSDAQ.",
    inputSchema: {
      marketType: z.string().optional().describe("000: all, 001: KOSPI, 101: KOSDAQ"),
      includeManaged: z.boolean().optional().describe("Include managed stocks"),
      creditType: z.string().optional().describe("Credit type"),
      volumeThreshold: z.string().optional().describe("Volume threshold code"),
      priceType: z.string().optional().describe("Price type code"),
      tradeValueType: z.string().optional().describe("Trade value type code"),
      marketOpenType: z.string().optional().describe("Market open type code"),
      stexTp: z.string().optional().describe("Exchange type, e.g. 1"),
    },
  },
  async ({ marketType, includeManaged, creditType, volumeThreshold, priceType, tradeValueType, marketOpenType, stexTp }) => {
    const query = new URLSearchParams();
    if (marketType) query.set("marketType", marketType);
    if (includeManaged !== undefined) query.set("includeManaged", String(includeManaged));
    if (creditType) query.set("creditType", creditType);
    if (volumeThreshold) query.set("volumeThreshold", volumeThreshold);
    if (priceType) query.set("priceType", priceType);
    if (tradeValueType) query.set("tradeValueType", tradeValueType);
    if (marketOpenType) query.set("marketOpenType", marketOpenType);
    if (stexTp) query.set("stexTp", stexTp);
    const data = await fetchJson(`/api/kiwoom/top-trading-volume?${query.toString()}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
  );

  server.registerTool(
  "kiwoom_condition_search",
  {
    title: "Kiwoom Condition Search",
    description: "Run a Kiwoom condition search (조건검색 요청).",
    inputSchema: {
      seq: z.string().describe("Condition sequence id"),
      searchType: z.string().optional().describe("0: 조건검색, 1: 조건검색+실시간"),
      stexTp: z.string().optional().describe("Exchange type, e.g. K"),
    },
  },
  async ({ seq, searchType, stexTp }) => {
    const data = await fetchJson("/api/kiwoom/conditions/search", {
      method: "POST",
      body: JSON.stringify({ seq, searchType, stexTp }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
  );

  server.registerTool(
  "kiwoom_condition_search_and_quotes",
  {
    title: "Kiwoom Condition Search + Quotes",
    description: "Run condition search then fetch quotes for matched symbols.",
    inputSchema: {
      seq: z.string().describe("Condition sequence id"),
      searchType: z.string().optional().describe("0: 조건검색, 1: 조건검색+실시간"),
      stexTp: z.string().optional().describe("Exchange type, e.g. K"),
    },
  },
  async ({ seq, searchType, stexTp }) => {
    const result = await fetchJson("/api/kiwoom/conditions/search", {
      method: "POST",
      body: JSON.stringify({ seq, searchType, stexTp }),
    });
    const symbols = Array.isArray(result.symbols) ? result.symbols : [];
    const quotes = symbols.length
      ? await fetchJson("/api/kiwoom/quotes", {
          method: "POST",
          body: JSON.stringify({ symbols }),
        })
      : { items: [], errors: [] };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ result, quotes }, null, 2),
        },
      ],
    };
  },
  );

  server.registerTool(
  "kiwoom_realtime_register",
  {
    title: "Kiwoom Realtime Register",
    description: "Register realtime subscriptions (체결/호가 등).",
    inputSchema: {
      symbols: z.array(z.string()).describe("Stock symbols"),
      types: z.array(z.string()).optional().describe("Realtime types like 0B, 0D"),
    },
  },
  async ({ symbols, types }) => {
    const data = await fetchJson("/api/kiwoom/realtime/register", {
      method: "POST",
      body: JSON.stringify({ symbols, types }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
  );

  server.registerTool(
  "kiwoom_realtime_signal",
  {
    title: "Kiwoom Realtime Signal",
    description: "Fetch the latest realtime signal for a symbol.",
    inputSchema: {
      symbol: z.string().describe("Stock symbol"),
    },
  },
  async ({ symbol }) => {
    const data = await fetchJson(`/api/kiwoom/realtime/signal?symbol=${encodeURIComponent(symbol)}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
  );

  server.registerTool(
  "kiwoom_realtime_signals",
  {
    title: "Kiwoom Realtime Signals",
    description: "Fetch realtime signals for multiple symbols.",
    inputSchema: {
      symbols: z.array(z.string()).describe("Stock symbols"),
    },
  },
  async ({ symbols }) => {
    const data = await fetchJson("/api/kiwoom/realtime/signals", {
      method: "POST",
      body: JSON.stringify({ symbols }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
  );

  return server;
};

const allowedHosts = MCP_ALLOWED_HOSTS
  ? MCP_ALLOWED_HOSTS.split(",")
      .map((host) => host.trim())
      .filter(Boolean)
  : undefined;
const app = createMcpExpressApp({ host: MCP_HOST, allowedHosts });
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(
      `[http] ${req.method} ${req.path} status=${res.statusCode} duration=${Date.now() - startedAt}ms`,
    );
  });
  next();
});
const transports: Record<string, StreamableHTTPServerTransport> = {};
const servers: Record<string, McpServer> = {};

const logError = (label: string, error: unknown) => {
  const err = error as Error & { code?: string };
  const details = {
    name: err?.name,
    message: err?.message,
    code: err?.code,
    stack: err?.stack,
  };
  console.error(label, details);
};

const handleStateless = async (req: express.Request, res: express.Response, body?: unknown) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createServer();
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    logError("[mcp] stateless handleRequest error", error);
    throw error;
  } finally {
    try {
      await transport.close();
    } catch {
      // ignore
    }
  }
};

const startRealtimeForwarding = () => {
  let source: EventSource | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const connect = () => {
    console.log(`[sse] connecting to ${PROXY_STREAM_URL}`);
    source = new EventSource(PROXY_STREAM_URL);
    source.onmessage = async (event) => {
      try {
        console.log(`[sse] message ${event.data}`);
        const data = event.data;
        await Promise.all(
          Object.values(servers).map((srv) =>
            srv.sendLoggingMessage({
              level: "info",
              data,
            }),
          ),
        );
      } catch {
        // ignore
      }
    };
    source.onerror = () => {
      console.error("[sse] error - reconnecting");
      if (source) {
        source.close();
      }
      if (reconnectTimer) {
        return;
      }
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 2000);
    };
  };

  connect();
};

startRealtimeForwarding();

const mcpPostHandler: express.RequestHandler = async (req, res) => {
  try {
    console.log(`[mcp] POST /mcp session=${req.headers["mcp-session-id"] ?? "none"}`);
    console.log(`[mcp] body=${JSON.stringify(req.body)}`);
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      await handleStateless(req, res, req.body);
      return;
    }
    if (sessionId && transports[sessionId]) {
      try {
        await transports[sessionId].handleRequest(req, res, req.body);
      } catch (error) {
        console.error(`[mcp] handleRequest error session=${sessionId} ${String(error)}`);
        throw error;
      }
      return;
    }

    if (isInitializeRequest(req.body)) {
      console.log("[mcp] initialize request");
      const newSessionId = sessionId ?? randomUUID();
      const transport = new StreamableHTTPServerTransport({ sessionId: newSessionId });
      const server = createServer();
      transport.onerror = (error) => {
        console.error(`[mcp] transport error session=${newSessionId} ${String(error)}`);
      };
      transport.onclose = () => {
        console.warn(`[mcp] transport closed session=${newSessionId}`);
      };
      transports[newSessionId] = transport;
      servers[newSessionId] = server;
      try {
        await server.connect(transport);
      } catch (error) {
        console.error(`[mcp] connect error session=${newSessionId} ${String(error)}`);
        throw error;
      }
      try {
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error(`[mcp] init handleRequest error session=${newSessionId} ${String(error)}`);
        throw error;
      }
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: null,
    });
  } catch (error) {
    logError("[mcp] error", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: (error as Error).message ?? "Internal server error",
        },
        id: null,
      });
    }
  }
};

const mcpGetHandler: express.RequestHandler = async (req, res) => {
  console.log(`[mcp] GET /mcp session=${req.headers["mcp-session-id"] ?? "none"}`);
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    await handleStateless(req, res);
    return;
  }
  if (!transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  try {
    await transports[sessionId].handleRequest(req, res);
  } catch (error) {
    console.error(`[mcp] GET handleRequest error session=${sessionId} ${String(error)}`);
    throw error;
  }
};

const mcpDeleteHandler: express.RequestHandler = async (req, res) => {
  console.log(`[mcp] DELETE /mcp session=${req.headers["mcp-session-id"] ?? "none"}`);
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    await handleStateless(req, res);
    return;
  }
  if (!transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  try {
    await transports[sessionId].handleRequest(req, res);
  } catch (error) {
    console.error(`[mcp] DELETE handleRequest error session=${sessionId} ${String(error)}`);
    throw error;
  }
  delete transports[sessionId];
  delete servers[sessionId];
};

app.post("/mcp", mcpPostHandler);
app.get("/mcp", mcpGetHandler);
app.delete("/mcp", mcpDeleteHandler);

app.listen(MCP_PORT, MCP_HOST, () => {
  console.log(`Kiwoom MCP server listening on ${MCP_HOST}:${MCP_PORT}`);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[mcp] unhandledRejection ${String(reason)}`);
});

process.on("uncaughtException", (error) => {
  console.error(`[mcp] uncaughtException ${String(error)}`);
});
