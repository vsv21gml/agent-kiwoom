import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import WebSocket from "ws";
import { Quote } from "../types";
import { ApiCallLog } from "../entities";
import { KiwoomEventsService } from "./kiwoom-events.service";

@Injectable()
export class KiwoomService {
  private readonly logger = new Logger(KiwoomService.name);
  private tokenCache: { accessToken: string; expiresAt: number } | null = null;
  private tokenRequestPromise: Promise<string> | null = null;
  private requestQueue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  private readonly minRequestIntervalMs = 333;
  private ws: WebSocket | null = null;
  private wsReady: Promise<void> | null = null;
  private wsConnected = false;
  private wsReconnectTimer: NodeJS.Timeout | null = null;
  private readonly realtimeCache = new Map<string, { price: number; asOf: string; type: string }>();
  private readonly orderbookCache = new Map<
    string,
    { bidTotal: number; askTotal: number; asOf: string; type: string }
  >();
  private readonly priceHistory = new Map<string, Array<{ price: number; at: number }>>();
  private readonly subscribedSymbols = new Set<string>();
  private readonly pendingWsRequests = new Map<
    string,
    Array<{ resolve: (payload: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>
  >();

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @InjectRepository(ApiCallLog) private readonly apiCallLogRepository: Repository<ApiCallLog>,
    @Inject(KiwoomEventsService) private readonly kiwoomEvents: KiwoomEventsService,
  ) {}

  async getQuote(symbol: string): Promise<Quote> {
    const useMock = (this.config.get<string>("KIWOOM_MOCK") ?? "true") === "true";
    if (useMock) {
      const mock = this.mockQuote(symbol);
      await this.logApi("GET", `/mock/quote/${symbol}`, null, mock, 200, true);
      return mock;
    }

    const baseUrl = this.config.get<string>("KIWOOM_BASE_URL") ?? "";
    const accessToken = await this.getAccessToken();
    const endpoint = `${baseUrl}/api/dostk/stkinfo`;
    const requestBody = { stk_cd: symbol };

    try {
      const response = await this.rateLimitedFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          authorization: `Bearer ${accessToken}`,
          "api-id": "ka10001",
        },
        body: JSON.stringify(requestBody),
      });

      const payload = await response.json();
      if (!response.ok) {
        await this.logApi("POST", endpoint, requestBody, payload, response.status, false);
        throw new Error(`Kiwoom quote request failed: ${response.status}`);
      }
      if (Number(payload.return_code ?? 0) !== 0) {
        await this.logApi("POST", endpoint, requestBody, payload, response.status, false);
        throw new Error(`Kiwoom quote return_code failed: ${String(payload.return_msg ?? payload.return_code)}`);
      }
      const quote: Quote = {
        symbol,
        price: Math.abs(
          this.toNumber(
            payload.currentPrice ??
              payload.cur_prc ??
              payload.stk_prpr ??
              payload.price ??
              0,
          ),
        ),
        changeRate: this.toNumber(
          payload.changeRate ??
            payload.flu_rt ??
            payload.fluc_rt ??
            payload.prdy_ctrt ??
            payload.rate ??
            0,
        ),
        volume: this.toNumber(payload.volume ?? payload.trde_qty ?? payload.acml_vol ?? 0),
        asOf: new Date().toISOString(),
      };

      await this.logApi("POST", endpoint, requestBody, payload, response.status, response.ok);
      const merged = this.applyRealtimeToQuote(quote);
      return {
        ...merged,
        asOf: this.getRealtimePrice(symbol)?.asOf ?? quote.asOf,
      };
    } catch (error) {
      await this.logApi("POST", endpoint, requestBody, { error: String(error) }, 500, false);
      this.logger.error(`Failed to fetch quote for ${symbol}: ${String(error)}`);
      throw error;
    }
  }

  async registerRealtimeQuotes(symbols: string[], types?: string[]) {
    const useMock = (this.config.get<string>("KIWOOM_MOCK") ?? "true") === "true";
    if (useMock || symbols.length === 0) {
      return;
    }

    const normalized = symbols.map((symbol) => this.normalizeSymbol(symbol)).filter(Boolean);
    const newSymbols = normalized.filter((symbol) => !this.subscribedSymbols.has(symbol));
    if (newSymbols.length === 0) {
      return;
    }

    const ws = await this.ensureWebSocket();
    const payload = {
      trnm: "REG",
      grp_no: "1",
      refresh: "1",
      data: [
        {
          item: newSymbols,
          type: types && types.length > 0 ? types : ["0B"],
        },
      ],
    };

    ws.send(JSON.stringify(payload));
    for (const symbol of newSymbols) {
      this.subscribedSymbols.add(symbol);
    }
    await this.logApi("WS", this.resolveWebSocketUrl(), payload, { status: "sent" }, 200, true);
  }

  async getConditionList() {
    const useMock = (this.config.get<string>("KIWOOM_MOCK") ?? "true") === "true";
    if (useMock) {
      const mock = {
        trnm: "CNSRLST",
        return_code: 0,
        data: [{ seq: "1", name: "Mock Condition" }],
      };
      await this.logApi("WS", this.resolveWebSocketUrl(), { trnm: "CNSRLST" }, mock, 200, true);
      return mock;
    }
    const payload = {
      trnm: "CNSRLST",
    };
    return this.sendWebSocketRequestWithApiId("CNSRLST", payload, "ka10171");
  }

  async requestConditionSearch(input: { seq: string; searchType?: string; stexTp?: string }) {
    const useMock = (this.config.get<string>("KIWOOM_MOCK") ?? "true") === "true";
    if (useMock) {
      const mock = {
        trnm: "CNSRREQ",
        seq: input.seq,
        return_code: 0,
        data: [{ jmcode: "005930" }, { jmcode: "000660" }],
      };
      await this.logApi("WS", this.resolveWebSocketUrl(), { trnm: "CNSRREQ", seq: input.seq }, mock, 200, true);
      return mock;
    }
    const payload = {
      trnm: "CNSRREQ",
      seq: String(input.seq),
      search_type: input.searchType ?? "0",
      stex_tp: input.stexTp ?? "K",
    };
    const apiId = payload.search_type === "1" ? "ka10173" : "ka10172";
    const response = await this.sendWebSocketRequestWithApiId("CNSRREQ", payload, apiId);
    const symbols = this.extractConditionSymbols(response);
    if (payload.search_type === "1" && symbols.length > 0) {
      await this.registerRealtimeQuotes(symbols, ["0B", "0D"]);
    }
    return { ...response, symbols };
  }

  getRealtimePrice(symbol: string) {
    const entry = this.realtimeCache.get(this.normalizeSymbol(symbol));
    if (!entry) {
      return null;
    }
    const ttlMs = Number(this.config.get<string>("KIWOOM_REALTIME_TTL_MS") ?? "15000");
    const ageMs = Date.now() - new Date(entry.asOf).getTime();
    if (Number.isNaN(ageMs) || ageMs > ttlMs) {
      return null;
    }
    return entry;
  }

  getRealtimeSignal(symbol: string) {
    const normalized = this.normalizeSymbol(symbol);
    const priceEntry = this.getRealtimePrice(normalized);
    const history = this.priceHistory.get(normalized) ?? [];
    const now = Date.now();
    const change1m = this.computeHistoryChange(history, now - 60_000);
    const change5m = this.computeHistoryChange(history, now - 5 * 60_000);
    const orderbook = this.orderbookCache.get(normalized);
    const bidTotal = orderbook?.bidTotal ?? null;
    const askTotal = orderbook?.askTotal ?? null;
    const imbalance =
      bidTotal !== null && askTotal !== null && bidTotal + askTotal > 0
        ? Number(((bidTotal - askTotal) / (bidTotal + askTotal)).toFixed(4))
        : null;

    return {
      symbol: normalized,
      price: priceEntry?.price ?? null,
      priceAsOf: priceEntry?.asOf ?? null,
      change1mPct: change1m,
      change5mPct: change5m,
      bidTotal,
      askTotal,
      orderbookImbalance: imbalance,
      orderbookAsOf: orderbook?.asOf ?? null,
    };
  }

  applyRealtimeToQuotes(quotes: Quote[]): Quote[] {
    return quotes.map((quote) => this.applyRealtimeToQuote(quote));
  }

  private applyRealtimeToQuote(quote: Quote): Quote {
    const realtime = this.getRealtimePrice(quote.symbol);
    if (!realtime) {
      return quote;
    }
    return {
      ...quote,
      price: realtime.price,
      asOf: realtime.asOf,
    };
  }

  async getDailyClosePrice(symbol: string) {
    const useMock = (this.config.get<string>("KIWOOM_MOCK") ?? "true") === "true";
    if (useMock) {
      const mock = {
        symbol,
        closePrice: this.mockQuote(symbol).price,
        asOf: new Date().toISOString(),
        source: "mock",
      };
      await this.logApi("GET", `/mock/daily-close/${symbol}`, null, mock, 200, true);
      return mock;
    }

    const { payload } = await this.postStkInfo("ka10081", {
      stk_cd: symbol,
      base_dt: "",
      upd_dt: "1",
    });

    const list = (payload.list ?? payload.items ?? payload.stk_chart ?? []) as Array<Record<string, unknown>>;
    const first = list[0] ?? (payload as Record<string, unknown>);
    const close = this.toNumber(first.close ?? first.stk_clpr ?? first.close_prc ?? first.clpr ?? 0);
    const date = String(first.date ?? first.stk_date ?? first.base_dt ?? "").trim();

    return {
      symbol,
      closePrice: Math.abs(close),
      asOf: date || new Date().toISOString(),
      source: "ka10081",
    };
  }

  async getStockList(marketType: string): Promise<
    Array<{
      symbol: string;
      name: string;
      listCount: number;
      lastPrice: number;
      marketCode?: string;
      marketName?: string;
    }>
  > {
    const useMock = (this.config.get<string>("KIWOOM_MOCK") ?? "true") === "true";
    if (useMock) {
      const mock = [
        {
          symbol: "005930",
          name: "Samsung Electronics",
          listCount: 5969782550,
          lastPrice: 70000,
          marketCode: "0",
          marketName: "KOSPI",
        },
      ];
      await this.logApi("GET", `/mock/stock-list/${marketType}`, null, mock, 200, true);
      return mock;
    }

    const items: Array<{
      symbol: string;
      name: string;
      listCount: number;
      lastPrice: number;
      marketCode?: string;
      marketName?: string;
    }> = [];

    let contYn = "N";
    let nextKey = "";
    do {
      const { payload, response } = await this.postStkInfo(
        "ka10099",
        { mrkt_tp: marketType },
        contYn === "Y" ? contYn : undefined,
        contYn === "Y" ? nextKey : undefined,
      );

      const list = (payload.list ?? payload.stk_list ?? payload.items ?? []) as Array<Record<string, unknown>>;
      for (const row of list) {
        const symbol = String(row.code ?? row.stk_cd ?? row.symbol ?? "").trim();
        const name = String(row.name ?? row.stk_nm ?? row.symbol_name ?? "").trim();
        if (!symbol) {
          continue;
        }
        const listCount = this.toNumber(row.listCount ?? row.list_count ?? row.list_cnt ?? 0);
        const lastPrice = Math.abs(this.toNumber(row.lastPrice ?? row.last_prc ?? row.last_price ?? row.cur_prc ?? 0));
        items.push({
          symbol,
          name,
          listCount,
          lastPrice,
          marketCode: String(row.marketCode ?? row.market_cd ?? row.mrkt_cd ?? "").trim() || undefined,
          marketName: String(row.marketName ?? row.market_nm ?? row.mrkt_nm ?? "").trim() || undefined,
        });
      }

      contYn = response.headers.get("cont-yn") ?? "N";
      nextKey = response.headers.get("next-key") ?? "";
    } while (contYn === "Y");

    return items;
  }

  async getTopTradingValue(input: { marketType: string; includeManaged?: boolean; stexType?: string }) {
    const useMock = (this.config.get<string>("KIWOOM_MOCK") ?? "true") === "true";
    if (useMock) {
      const mock = [
        { symbol: "005930", name: "Samsung Electronics", price: 70000, volumeValue: 1000000000 },
      ];
      await this.logApi("GET", `/mock/top-trading-value/${input.marketType}`, input, mock, 200, true);
      return mock;
    }

    const includeManaged = input.includeManaged ? "1" : "0";
    const stexType = input.stexType ?? "1";
    const body = {
      mrkt_tp: input.marketType,
      mang_stk_incls: includeManaged,
      stex_tp: stexType,
    };

    const { payload } = await this.postRankInfo("ka10032", body);
    const list = (payload.trde_prica_upper ?? payload.list ?? payload.items ?? []) as Array<Record<string, unknown>>;
    return list.map((row) => ({
      symbol: String(row.stk_cd ?? row.code ?? row.symbol ?? "").trim(),
      name: String(row.stk_nm ?? row.name ?? "").trim(),
      price: Math.abs(this.toNumber(row.cur_prc ?? row.price ?? row.now_price ?? 0)),
      volumeValue: this.toNumber(row.trde_prica ?? row.trde_amt ?? row.trade_value ?? row.amount ?? 0),
    }));
  }

  async getTopTradingVolume(input: {
    marketType: string;
    includeManaged?: boolean;
    creditType?: string;
    volumeThreshold?: string;
    priceType?: string;
    tradeValueType?: string;
    marketOpenType?: string;
    stexType?: string;
  }) {
    const useMock = (this.config.get<string>("KIWOOM_MOCK") ?? "true") === "true";
    if (useMock) {
      const mock = [
        { symbol: "005930", name: "Samsung Electronics", price: 70000, volume: 10000000 },
      ];
      await this.logApi("GET", `/mock/top-trading-volume/${input.marketType}`, input, mock, 200, true);
      return mock;
    }

    const body = {
      mrkt_tp: input.marketType,
      sort_tp: "1",
      mang_stk_incls: input.includeManaged ? "0" : "1",
      crd_tp: input.creditType ?? "0",
      trde_qty_tp: input.volumeThreshold ?? "0",
      pric_tp: input.priceType ?? "0",
      trde_prica_tp: input.tradeValueType ?? "0",
      mrkt_open_tp: input.marketOpenType ?? "1",
      stex_tp: input.stexType ?? "1",
    };

    const { payload } = await this.postRankInfo("ka10030", body);
    const list = (payload.tdy_trde_qty_upper ?? payload.list ?? payload.items ?? []) as Array<Record<string, unknown>>;
    return list.map((row) => ({
      symbol: String(row.stk_cd ?? row.code ?? row.symbol ?? "").trim(),
      name: String(row.stk_nm ?? row.name ?? "").trim(),
      price: Math.abs(this.toNumber(row.cur_prc ?? row.price ?? row.now_price ?? 0)),
      volume: this.toNumber(row.trde_qty ?? row.volume ?? row.qty ?? 0),
    }));
  }

  async getIntradayTicks(input: { symbol: string; tickScope: string; adjustedPrice?: string }) {
    const useMock = (this.config.get<string>("KIWOOM_MOCK") ?? "true") === "true";
    if (useMock) {
      const mock = {
        symbol: input.symbol,
        ticks: [
          {
            price: 70000,
            volume: 120,
            time: new Date().toISOString(),
            open: 70000,
            high: 70100,
            low: 69900,
          },
        ],
        source: "mock",
      };
      await this.logApi("GET", `/mock/intraday-ticks/${input.symbol}`, input, mock, 200, true);
      return mock;
    }

    const body = {
      stk_cd: input.symbol,
      tic_scope: input.tickScope,
      upd_stkpc_tp: input.adjustedPrice ?? "1",
    };
    const { payload } = await this.postChartInfo("ka10079", body);
    const list = (payload.stk_tic_chart_qry ?? payload.list ?? payload.items ?? []) as Array<Record<string, unknown>>;
    return {
      symbol: String(payload.stk_cd ?? input.symbol),
      ticks: list.map((row) => ({
        price: Math.abs(this.toNumber(row.cur_prc ?? row.price ?? 0)),
        volume: this.toNumber(row.trde_qty ?? row.volume ?? 0),
        time: String(row.cntr_tm ?? row.time ?? ""),
        open: Math.abs(this.toNumber(row.open_pric ?? row.open ?? 0)),
        high: Math.abs(this.toNumber(row.high_pric ?? row.high ?? 0)),
        low: Math.abs(this.toNumber(row.low_pric ?? row.low ?? 0)),
        change: this.toNumber(row.pred_pre ?? row.change ?? 0),
        changeSign: String(row.pred_pre_sig ?? row.change_sign ?? ""),
      })),
    };
  }

  async getIntradayMinutes(input: { symbol: string; minuteScope: string; baseDate?: string; adjustedPrice?: string }) {
    const useMock = (this.config.get<string>("KIWOOM_MOCK") ?? "true") === "true";
    if (useMock) {
      const mock = {
        symbol: input.symbol,
        minutes: [
          {
            price: 70000,
            volume: 2400,
            time: new Date().toISOString(),
            open: 70000,
            high: 70100,
            low: 69900,
          },
        ],
        source: "mock",
      };
      await this.logApi("GET", `/mock/intraday-minutes/${input.symbol}`, input, mock, 200, true);
      return mock;
    }

    const body = {
      stk_cd: input.symbol,
      tic_scope: input.minuteScope,
      upd_stkpc_tp: input.adjustedPrice ?? "1",
      base_dt: input.baseDate ?? "",
    };
    const { payload } = await this.postChartInfo("ka10080", body);
    const list = (payload.stk_min_pole_chart_qry ?? payload.list ?? payload.items ?? []) as Array<Record<string, unknown>>;
    return {
      symbol: String(payload.stk_cd ?? input.symbol),
      minutes: list.map((row) => ({
        price: Math.abs(this.toNumber(row.cur_prc ?? row.price ?? 0)),
        volume: this.toNumber(row.trde_qty ?? row.volume ?? 0),
        time: String(row.cntr_tm ?? row.time ?? ""),
        open: Math.abs(this.toNumber(row.open_pric ?? row.open ?? 0)),
        high: Math.abs(this.toNumber(row.high_pric ?? row.high ?? 0)),
        low: Math.abs(this.toNumber(row.low_pric ?? row.low ?? 0)),
        change: this.toNumber(row.pred_pre ?? row.change ?? 0),
        changeSign: String(row.pred_pre_sig ?? row.change_sign ?? ""),
      })),
    };
  }

  async getAccountEvaluation(input: { queryType?: string; exchangeType?: string }) {
    const useMock = (this.config.get<string>("KIWOOM_MOCK") ?? "true") === "true";
    if (useMock) {
      const mock = {
        cash: 10000000,
        totalAsset: 15000000,
        holdingsValue: 5000000,
        holdings: [],
        source: "mock",
      };
      await this.logApi("GET", "/mock/account-evaluation", input, mock, 200, true);
      return mock;
    }

    const body = {
      qry_tp: input.queryType ?? "1",
      dmst_stex_tp: input.exchangeType ?? "KRX",
    };
    const { payload } = await this.postAccountInfo("kt00018", body);

    const holdings = (payload.acnt_evlt_remn_indv_tot ?? payload.list ?? []) as Array<Record<string, unknown>>;
    const holdingsMapped = holdings.map((row) => ({
      symbol: this.normalizeSymbol(String(row.stk_cd ?? row.symbol ?? "")),
      name: String(row.stk_nm ?? row.name ?? ""),
      quantity: this.toNumber(row.rmnd_qty ?? row.qty ?? 0),
      tradableQuantity: this.toNumber(row.trde_able_qty ?? 0),
      avgPrice: Math.abs(this.toNumber(row.pur_pric ?? row.avg_price ?? 0)),
      price: Math.abs(this.toNumber(row.cur_prc ?? row.price ?? 0)),
      marketValue: Math.abs(this.toNumber(row.evlt_amt ?? row.market_value ?? 0)),
      unrealizedPnl: this.toNumber(row.evltv_prft ?? row.pnl ?? 0),
      profitRate: this.toNumber(row.prft_rt ?? 0),
    }));

    const holdingsValue = this.toNumber(payload.tot_evlt_amt ?? 0);
    const totalAsset = this.toNumber(payload.prsm_dpst_aset_amt ?? 0);
    const cash = totalAsset - holdingsValue;

    return {
      cash,
      totalAsset,
      holdingsValue,
      holdings: holdingsMapped,
      raw: payload,
      source: "kt00018",
    };
  }

  async placeOrder(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; price: number }) {
    const useMock = (this.config.get<string>("KIWOOM_MOCK") ?? "true") === "true";
    if (useMock) {
      const payload = { orderId: `mock-${Date.now()}`, status: "accepted", ...input };
      await this.logApi("POST", "/mock/orders", input, payload, 200, true);
      return payload;
    }

    const baseUrl = this.config.get<string>("KIWOOM_BASE_URL") ?? "";
    const accessToken = await this.getAccessToken();
    const endpoint = `${baseUrl}/orders`;

    try {
      const response = await this.rateLimitedFetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-APP-KEY": this.config.get<string>("KIWOOM_APP_KEY") ?? "",
          "X-APP-SECRET": this.config.get<string>("KIWOOM_APP_SECRET") ?? "",
        },
        body: JSON.stringify(input),
      });

      const payload = await response.json();
      await this.logApi("POST", endpoint, input, payload, response.status, response.ok);
      return payload;
    } catch (error) {
      await this.logApi("POST", endpoint, input, { error: String(error) }, 500, false);
      throw error;
    }
  }

  private mockQuote(symbol: string): Quote {
    const base = 50000 + Math.round(Math.random() * 100000);
    const changeRate = Number(((Math.random() - 0.5) * 6).toFixed(2));
    return {
      symbol,
      price: base,
      changeRate,
      volume: Math.round(100000 + Math.random() * 500000),
      asOf: new Date().toISOString(),
    };
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt - 60_000 > now) {
      return this.tokenCache.accessToken;
    }

    if (!this.tokenRequestPromise) {
      this.tokenRequestPromise = this.issueAccessToken().finally(() => {
        this.tokenRequestPromise = null;
      });
    }

    return this.tokenRequestPromise;
  }

  private async postStkInfo(
    apiId: string,
    body: Record<string, unknown>,
    contYn?: string,
    nextKey?: string,
  ): Promise<{ payload: Record<string, unknown>; response: Response }> {
    const baseUrl = this.config.get<string>("KIWOOM_BASE_URL") ?? "";
    const accessToken = await this.getAccessToken();
    const endpoint = `${baseUrl}/api/dostk/stkinfo`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json;charset=UTF-8",
      authorization: `Bearer ${accessToken}`,
      "api-id": apiId,
    };
    if (contYn) {
      headers["cont-yn"] = contYn;
    }
    if (nextKey) {
      headers["next-key"] = nextKey;
    }

    const response = await this.rateLimitedFetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const success = response.ok && Number(payload.return_code ?? 0) === 0;
    await this.logApi("POST", endpoint, body, payload, response.status, success);

    if (!response.ok) {
      throw new Error(`Kiwoom request failed: ${response.status}`);
    }
    if (Number(payload.return_code ?? 0) !== 0) {
      throw new Error(`Kiwoom return_code failed: ${String(payload.return_msg ?? payload.return_code)}`);
    }

    return { payload, response };
  }

  private async postRankInfo(
    apiId: string,
    body: Record<string, unknown>,
    contYn?: string,
    nextKey?: string,
  ): Promise<{ payload: Record<string, unknown>; response: Response }> {
    const baseUrl = this.config.get<string>("KIWOOM_BASE_URL") ?? "";
    const accessToken = await this.getAccessToken();
    const endpoint = `${baseUrl}/api/dostk/rkinfo`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json;charset=UTF-8",
      authorization: `Bearer ${accessToken}`,
      "api-id": apiId,
    };
    if (contYn) {
      headers["cont-yn"] = contYn;
    }
    if (nextKey) {
      headers["next-key"] = nextKey;
    }

    const response = await this.rateLimitedFetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const success = response.ok && Number(payload.return_code ?? 0) === 0;
    await this.logApi("POST", endpoint, body, payload, response.status, success);

    if (!response.ok) {
      throw new Error(`Kiwoom request failed: ${response.status}`);
    }
    if (Number(payload.return_code ?? 0) !== 0) {
      throw new Error(`Kiwoom return_code failed: ${String(payload.return_msg ?? payload.return_code)}`);
    }

    return { payload, response };
  }

  private async postChartInfo(
    apiId: string,
    body: Record<string, unknown>,
    contYn?: string,
    nextKey?: string,
  ): Promise<{ payload: Record<string, unknown>; response: Response }> {
    const baseUrl = this.config.get<string>("KIWOOM_BASE_URL") ?? "";
    const accessToken = await this.getAccessToken();
    const endpoint = `${baseUrl}/api/dostk/chart`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json;charset=UTF-8",
      authorization: `Bearer ${accessToken}`,
      "api-id": apiId,
    };
    if (contYn) {
      headers["cont-yn"] = contYn;
    }
    if (nextKey) {
      headers["next-key"] = nextKey;
    }

    const response = await this.rateLimitedFetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const success = response.ok && Number(payload.return_code ?? 0) === 0;
    await this.logApi("POST", endpoint, body, payload, response.status, success);

    if (!response.ok) {
      throw new Error(`Kiwoom request failed: ${response.status}`);
    }
    if (Number(payload.return_code ?? 0) !== 0) {
      throw new Error(`Kiwoom return_code failed: ${String(payload.return_msg ?? payload.return_code)}`);
    }

    return { payload, response };
  }

  private async postAccountInfo(
    apiId: string,
    body: Record<string, unknown>,
    contYn?: string,
    nextKey?: string,
  ): Promise<{ payload: Record<string, unknown>; response: Response }> {
    const baseUrl = this.config.get<string>("KIWOOM_BASE_URL") ?? "";
    const accessToken = await this.getAccessToken();
    const endpoint = `${baseUrl}/api/dostk/acnt`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json;charset=UTF-8",
      authorization: `Bearer ${accessToken}`,
      "api-id": apiId,
    };
    if (contYn) {
      headers["cont-yn"] = contYn;
    }
    if (nextKey) {
      headers["next-key"] = nextKey;
    }

    const response = await this.rateLimitedFetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const success = response.ok && Number(payload.return_code ?? 0) === 0;
    await this.logApi("POST", endpoint, body, payload, response.status, success);

    if (!response.ok) {
      throw new Error(`Kiwoom request failed: ${response.status}`);
    }
    if (Number(payload.return_code ?? 0) !== 0) {
      throw new Error(`Kiwoom return_code failed: ${String(payload.return_msg ?? payload.return_code)}`);
    }

    return { payload, response };
  }

  private async issueAccessToken(): Promise<string> {
    const baseUrl = this.config.get<string>("KIWOOM_BASE_URL") ?? "";
    const appKey = this.config.get<string>("KIWOOM_APP_KEY") ?? "";
    const appSecret = this.config.get<string>("KIWOOM_APP_SECRET") ?? "";
    if (!appKey || !appSecret) {
      throw new Error("KIWOOM_APP_KEY or KIWOOM_APP_SECRET is missing while KIWOOM_MOCK=false");
    }

    const endpoint = `${baseUrl}/oauth2/token`;
    const requestBody = {
      grant_type: "client_credentials",
      appkey: appKey,
      secretkey: appSecret,
    };

    const response = await this.rateLimitedFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "api-id": "au10001",
      },
      body: JSON.stringify(requestBody),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      await this.logApi(
        "POST",
        endpoint,
        { ...requestBody, appkey: "***", secretkey: "***" },
        this.redactTokenFields(payload),
        response.status,
        false,
      );
      throw new Error(`Kiwoom token request failed: ${response.status}`);
    }

    const accessToken = (payload.access_token ?? payload.token) as string | undefined;
    if (!accessToken) {
      await this.logApi(
        "POST",
        endpoint,
        { ...requestBody, appkey: "***", secretkey: "***" },
        this.redactTokenFields(payload),
        response.status,
        false,
      );
      throw new Error("Kiwoom token response does not contain access token");
    }

    const expiresAt = this.resolveTokenExpiry(payload);
    this.tokenCache = {
      accessToken,
      expiresAt,
    };

    await this.logApi(
      "POST",
      endpoint,
      { ...requestBody, appkey: "***", secretkey: "***" },
      this.redactTokenFields(payload),
      response.status,
      true,
    );

    return accessToken;
  }

  private resolveTokenExpiry(payload: Record<string, unknown>): number {
    const expiresDt = payload.expires_dt;
    if (typeof expiresDt === "string") {
      const parsed = new Date(expiresDt).getTime();
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    const expiresIn = payload.expires_in;
    if (typeof expiresIn === "number") {
      return Date.now() + expiresIn * 1000;
    }

    return Date.now() + 50 * 60 * 1000;
  }

  private redactTokenFields(payload: Record<string, unknown>): Record<string, unknown> {
    const clone = { ...payload };
    if (typeof clone.access_token === "string") {
      clone.access_token = "***";
    }
    if (typeof clone.token === "string") {
      clone.token = "***";
    }
    if (typeof clone.refresh_token === "string") {
      clone.refresh_token = "***";
    }
    return clone;
  }

  private toNumber(value: unknown): number {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      return Number(value.replaceAll(",", "").trim() || "0");
    }
    return 0;
  }

  private resolveWebSocketUrl() {
    const useMock = (this.config.get<string>("KIWOOM_MOCK") ?? "true") === "true";
    const override = this.config.get<string>("KIWOOM_WS_URL");
    if (override) {
      return override;
    }
    return useMock
      ? "wss://mockapi.kiwoom.com:10000/api/dostk/websocket"
      : "wss://api.kiwoom.com:10000/api/dostk/websocket";
  }

  private async ensureWebSocket(): Promise<WebSocket> {
    if (this.ws && this.wsConnected) {
      return this.ws;
    }
    if (this.wsReady) {
      await this.wsReady;
      if (this.ws && this.wsConnected) {
        return this.ws;
      }
    }

    const connectPromise = this.connectWebSocket();
    this.wsReady = connectPromise;
    await connectPromise;
    if (!this.ws) {
      throw new Error("Kiwoom websocket connection failed");
    }
    return this.ws;
  }

  private async connectWebSocket() {
    const url = this.resolveWebSocketUrl();
    const accessToken = await this.getAccessToken();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }

    this.wsConnected = false;
    this.ws = new WebSocket(url, {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket not initialized"));
        return;
      }

      const cleanup = () => {
        this.ws?.removeListener("open", onOpen);
        this.ws?.removeListener("error", onError);
      };

      const onOpen = () => {
        this.ws?.on("message", (data) => this.handleRealtimeMessage(data));
        const loginPayload = { trnm: "LOGIN", token: accessToken };
        this.ws?.send(JSON.stringify(loginPayload));
        const onLogin = (data: WebSocket.RawData) => {
          const text = typeof data === "string" ? data : data.toString("utf-8");
          let payload: Record<string, unknown> | null = null;
          try {
            payload = JSON.parse(text) as Record<string, unknown>;
          } catch {
            return;
          }
          const trnm = String(payload?.trnm ?? "");
          if (trnm === "PING") {
            this.ws?.send(text);
            return;
          }
          if (trnm !== "LOGIN") {
            return;
          }
          const returnCode = String(payload?.return_code ?? "");
          if (returnCode !== "0") {
            cleanup();
            reject(new Error(`Kiwoom WS LOGIN failed: ${String(payload?.return_msg ?? returnCode)}`));
            return;
          }
          this.ws?.off("message", onLogin);
          this.wsConnected = true;
          cleanup();
          resolve();
        };
        this.ws?.on("message", onLogin);
        this.ws?.on("close", () => this.handleWebSocketClose());
        this.ws?.on("error", (error) => this.handleWebSocketError(error));
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      this.ws?.once("open", onOpen);
      this.ws?.once("error", onError);
    }).finally(() => {
      this.wsReady = null;
    });
  }

  private handleWebSocketClose() {
    this.wsConnected = false;
    this.ws = null;
    this.scheduleReconnect();
  }

  private handleWebSocketError(error: Error) {
    this.logger.warn(`Kiwoom websocket error: ${error.message}`);
  }

  private scheduleReconnect() {
    if (this.wsReconnectTimer) {
      return;
    }
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      this.ensureWebSocket().catch((error) => {
        this.logger.warn(`Kiwoom websocket reconnect failed: ${String(error)}`);
      });
    }, 2000);
  }

  private handleRealtimeMessage(data: WebSocket.RawData) {
    const text = typeof data === "string" ? data : data.toString("utf-8");
    if (!text) {
      return;
    }

    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!payload) {
      return;
    }

    if (payload.trnm === "PING") {
      this.ws?.send(text);
      return;
    }

    if (payload.trnm !== "REAL") {
      const key = String(payload.trnm ?? "");
      const queue = this.pendingWsRequests.get(key);
      if (queue && queue.length > 0) {
        const entry = queue.shift();
        if (entry) {
          clearTimeout(entry.timer);
          entry.resolve(payload);
        }
        if (queue.length === 0) {
          this.pendingWsRequests.delete(key);
        }
      }
      return;
    }

    const list = (payload.data ?? []) as Array<Record<string, unknown>>;
    for (const entry of list) {
      const values = (entry.values ?? {}) as Record<string, unknown>;
      const symbolRaw = (values["9001"] ?? entry.item ?? entry.name ?? "") as string;
      const symbol = this.normalizeSymbol(symbolRaw);
      if (!symbol) {
        continue;
      }

      const type = String(entry.type ?? "");
      const conditionFlag = values["843"];
      if (conditionFlag === "I" || conditionFlag === "D") {
        this.kiwoomEvents.emit({
          type: "condition",
          data: {
            action: conditionFlag,
            symbol,
            time: values["20"] ?? null,
            raw: entry,
          },
        });
      }
      if (type === "0D") {
        const bidTotal = this.toNumber(values["6065"] ?? values["bid_total"] ?? values["total_bid"]);
        const askTotal = this.toNumber(values["6064"] ?? values["ask_total"] ?? values["total_ask"]);
        if (bidTotal || askTotal) {
          this.orderbookCache.set(symbol, {
            bidTotal,
            askTotal,
            asOf: new Date().toISOString(),
            type,
          });
        }
        continue;
      }

      const priceValue = values["10"] ?? values["currentPrice"] ?? values["cur_prc"];
      const price = Math.abs(this.toNumber(priceValue));
      if (!price) {
        continue;
      }
      const asOf = new Date().toISOString();
      this.realtimeCache.set(symbol, {
        price,
        asOf,
        type,
      });
      this.appendPriceHistory(symbol, price);
    }
  }

  private normalizeSymbol(value: string) {
    if (!value) {
      return "";
    }
    return value.replace(/^A/, "").trim();
  }

  private extractConditionSymbols(payload: Record<string, unknown>) {
    const list = (payload.data ?? []) as Array<Record<string, unknown>>;
    const symbols = new Set<string>();
    for (const entry of list) {
      const raw = String(entry.jmcode ?? entry.code ?? entry.symbol ?? "");
      const normalized = this.normalizeSymbol(raw);
      if (normalized) {
        symbols.add(normalized);
      }
    }
    return Array.from(symbols);
  }

  private async sendWebSocketRequest(
    trnm: string,
    payload: Record<string, unknown>,
    timeoutMs: number = 10_000,
  ) {
    const ws = await this.ensureWebSocket();
    await this.logApi("WS", this.resolveWebSocketUrl(), payload, { status: "sent" }, 200, true);
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        const queue = this.pendingWsRequests.get(trnm) ?? [];
        this.pendingWsRequests.set(
          trnm,
          queue.filter((entry) => entry.resolve !== resolve),
        );
        reject(new Error(`Kiwoom websocket request timeout for ${trnm}`));
      }, timeoutMs);

      const queue = this.pendingWsRequests.get(trnm) ?? [];
      queue.push({ resolve, reject, timer });
      this.pendingWsRequests.set(trnm, queue);

      ws.send(JSON.stringify(payload));
    });
  }

  private async sendWebSocketRequestWithApiId(
    trnm: string,
    payload: Record<string, unknown>,
    apiId: string,
    timeoutMs: number = 10_000,
  ) {
    const url = this.resolveWebSocketUrl();
    const accessToken = await this.getAccessToken();
    await this.logApi("WS", url, { ...payload, apiId }, { status: "sent" }, 200, true);

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "api-id": apiId,
        },
      });

      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Kiwoom websocket request timeout for ${trnm}`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        ws.removeAllListeners();
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({ trnm: "LOGIN", token: accessToken }));
      });

      ws.on("message", (data) => {
        const text = typeof data === "string" ? data : data.toString("utf-8");
        let response: Record<string, unknown> | null = null;
        try {
          response = JSON.parse(text) as Record<string, unknown>;
        } catch {
          return;
        }
        if (!response) {
          return;
        }
        const responseTrnm = String(response.trnm ?? "");
        if (responseTrnm === "PING") {
          ws.send(text);
          return;
        }
        if (responseTrnm === "LOGIN") {
          const returnCode = String(response?.return_code ?? "");
          if (returnCode !== "0") {
            cleanup();
            ws.close();
            reject(new Error(`Kiwoom WS LOGIN failed: ${String(response?.return_msg ?? returnCode)}`));
            return;
          }
          ws.send(JSON.stringify(payload));
          return;
        }
        if (responseTrnm !== trnm) {
          return;
        }
        cleanup();
        ws.close();
        resolve(response);
      });

      ws.on("error", (error) => {
        cleanup();
        ws.close();
        reject(error as Error);
      });
    });
  }

  private appendPriceHistory(symbol: string, price: number) {
    const now = Date.now();
    const history = this.priceHistory.get(symbol) ?? [];
    history.push({ price, at: now });
    const cutoff = now - 5 * 60_000;
    while (history.length > 0 && history[0].at < cutoff) {
      history.shift();
    }
    this.priceHistory.set(symbol, history);
  }

  private computeHistoryChange(history: Array<{ price: number; at: number }>, sinceAt: number) {
    if (history.length === 0) {
      return null;
    }
    const recent = history[history.length - 1];
    const base = history.find((entry) => entry.at >= sinceAt) ?? history[0];
    if (!base || base.price === 0) {
      return null;
    }
    return Number((((recent.price - base.price) / base.price) * 100).toFixed(4));
  }

  private async logApi(
    method: string,
    endpoint: string,
    requestBody: unknown,
    responseBody: unknown,
    statusCode: number,
    success: boolean,
  ) {
    await this.apiCallLogRepository.save({
      provider: "kiwoom",
      endpoint,
      method,
      requestBody: (requestBody as Record<string, unknown>) ?? null,
      responseBody: (responseBody as Record<string, unknown>) ?? null,
      statusCode,
      success,
      errorMessage: success ? null : JSON.stringify(responseBody),
    });
  }

  private async scheduleRequest<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const now = Date.now();
      const waitMs = this.minRequestIntervalMs - (now - this.lastRequestAt);
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      this.lastRequestAt = Date.now();
      return fn();
    };

    const next = this.requestQueue.then(run, run);
    this.requestQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private rateLimitedFetch(input: string, init: RequestInit) {
    return this.scheduleRequest(() => fetch(input, init));
  }
}
