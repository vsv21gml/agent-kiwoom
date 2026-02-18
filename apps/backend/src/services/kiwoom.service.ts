import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Quote } from "../types";
import { ApiCallLog } from "../entities";

@Injectable()
export class KiwoomService {
  private readonly logger = new Logger(KiwoomService.name);
  private tokenCache: { accessToken: string; expiresAt: number } | null = null;
  private tokenRequestPromise: Promise<string> | null = null;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @InjectRepository(ApiCallLog) private readonly apiCallLogRepository: Repository<ApiCallLog>,
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
      const response = await fetch(endpoint, {
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
        price: this.toNumber(
          payload.currentPrice ??
            payload.cur_prc ??
            payload.stk_prpr ??
            payload.price ??
            0,
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
      return quote;
    } catch (error) {
      await this.logApi("POST", endpoint, requestBody, { error: String(error) }, 500, false);
      this.logger.error(`Failed to fetch quote for ${symbol}: ${String(error)}`);
      throw error;
    }
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
      const response = await fetch(endpoint, {
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

    const response = await fetch(endpoint, {
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
}
