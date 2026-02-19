import { Body, Controller, Get, Inject, MessageEvent, Post, Query, Sse } from "@nestjs/common";
import { Observable } from "rxjs";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Holding } from "../entities";
import { KiwoomEventsService } from "../services/kiwoom-events.service";
import { KiwoomService } from "../services/kiwoom.service";
import { TradingService } from "../services/trading.service";

@Controller("kiwoom")
export class KiwoomController {
  constructor(
    @Inject(KiwoomService) private readonly kiwoom: KiwoomService,
    @Inject(TradingService) private readonly trading: TradingService,
    @InjectRepository(Holding) private readonly holdingRepository: Repository<Holding>,
    @Inject(KiwoomEventsService) private readonly kiwoomEvents: KiwoomEventsService,
  ) {}

  @Get("quote")
  async getQuote(@Query("symbol") symbol: string) {
    if (!symbol) {
      return { error: "symbol is required" };
    }
    return this.kiwoom.getQuote(symbol);
  }

  @Get("daily-close")
  async getDailyClose(@Query("symbol") symbol: string) {
    if (!symbol) {
      return { error: "symbol is required" };
    }
    return this.kiwoom.getDailyClosePrice(symbol);
  }

  @Post("quotes")
  async getQuotes(@Body() body: { symbols?: string[] }) {
    const symbols = body.symbols?.filter(Boolean) ?? [];
    if (symbols.length === 0) {
      return { items: [], errors: ["symbols is required"] };
    }

    const settled = await Promise.allSettled(symbols.map((symbol) => this.kiwoom.getQuote(symbol)));
    const items = settled
      .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<KiwoomService["getQuote"]>>> => result.status === "fulfilled")
      .map((result) => result.value);
    const errors = settled
      .map((result, idx) => (result.status === "rejected" ? `${symbols[idx]}: ${String(result.reason)}` : null))
      .filter(Boolean);

    return { items, errors };
  }

  @Get("account")
  async getAccountSummary() {
    const state = await this.trading.ensurePortfolioState();
    const holdings = await this.holdingRepository.find();
    const settled = await Promise.allSettled(holdings.map((holding) => this.kiwoom.getQuote(holding.symbol)));
    const priceMap = new Map(
      settled
        .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<KiwoomService["getQuote"]>>> => result.status === "fulfilled")
        .map((result) => [result.value.symbol, result.value.price]),
    );

    const holdingDetails = holdings.map((holding) => {
      const lastPrice = priceMap.get(holding.symbol) ?? holding.avgPrice;
      const marketValue = lastPrice * holding.quantity;
      const unrealizedPnl = (lastPrice - holding.avgPrice) * holding.quantity;
      return {
        symbol: holding.symbol,
        quantity: holding.quantity,
        avgPrice: holding.avgPrice,
        lastPrice,
        marketValue,
        unrealizedPnl,
      };
    });

    const holdingsValue = holdingDetails.reduce((acc, item) => acc + item.marketValue, 0);
    return {
      cash: state.cash,
      holdingsValue,
      totalAsset: state.cash + holdingsValue,
      holdings: holdingDetails,
      mode: state.virtualMode ? "VIRTUAL" : "REAL",
    };
  }

  @Get("holdings")
  async getHoldings() {
    return this.getAccountSummary();
  }

  @Get("conditions")
  async getConditionList() {
    return this.kiwoom.getConditionList();
  }

  @Get("top-trading-value")
  async getTopTradingValue(
    @Query("marketType") marketType?: string,
    @Query("includeManaged") includeManaged?: string,
    @Query("stexTp") stexTp?: string,
  ) {
    const type = marketType ?? "0";
    return this.kiwoom.getTopTradingValue({
      marketType: type,
      includeManaged: includeManaged === "true",
      stexType: stexTp,
    });
  }

  @Get("top-trading-volume")
  async getTopTradingVolume(
    @Query("marketType") marketType?: string,
    @Query("includeManaged") includeManaged?: string,
    @Query("creditType") creditType?: string,
    @Query("volumeThreshold") volumeThreshold?: string,
    @Query("priceType") priceType?: string,
    @Query("tradeValueType") tradeValueType?: string,
    @Query("marketOpenType") marketOpenType?: string,
    @Query("stexTp") stexTp?: string,
  ) {
    const type = marketType ?? "000";
    return this.kiwoom.getTopTradingVolume({
      marketType: type,
      includeManaged: includeManaged === "true",
      creditType,
      volumeThreshold,
      priceType,
      tradeValueType,
      marketOpenType,
      stexType: stexTp,
    });
  }

  @Get("intraday/ticks")
  async getIntradayTicks(
    @Query("symbol") symbol?: string,
    @Query("tickScope") tickScope?: string,
    @Query("adjustedPrice") adjustedPrice?: string,
  ) {
    if (!symbol || !tickScope) {
      return { error: "symbol and tickScope are required" };
    }
    return this.kiwoom.getIntradayTicks({
      symbol,
      tickScope,
      adjustedPrice,
    });
  }

  @Get("intraday/minutes")
  async getIntradayMinutes(
    @Query("symbol") symbol?: string,
    @Query("minuteScope") minuteScope?: string,
    @Query("baseDate") baseDate?: string,
    @Query("adjustedPrice") adjustedPrice?: string,
  ) {
    if (!symbol || !minuteScope) {
      return { error: "symbol and minuteScope are required" };
    }
    return this.kiwoom.getIntradayMinutes({
      symbol,
      minuteScope,
      baseDate,
      adjustedPrice,
    });
  }

  @Post("conditions/search")
  async searchCondition(@Body() body: { seq?: string; searchType?: string; stexTp?: string }) {
    if (!body.seq) {
      return { error: "seq is required" };
    }
    return this.kiwoom.requestConditionSearch({
      seq: body.seq,
      searchType: body.searchType,
      stexTp: body.stexTp,
    });
  }

  @Post("realtime/register")
  async registerRealtime(@Body() body: { symbols?: string[]; types?: string[] }) {
    const symbols = body.symbols?.filter(Boolean) ?? [];
    const types = body.types?.filter(Boolean) ?? undefined;
    if (symbols.length === 0) {
      return { error: "symbols is required" };
    }
    await this.kiwoom.registerRealtimeQuotes(symbols, types);
    return { ok: true, symbols, types };
  }

  @Get("realtime/signal")
  async getRealtimeSignal(@Query("symbol") symbol: string) {
    if (!symbol) {
      return { error: "symbol is required" };
    }
    return this.kiwoom.getRealtimeSignal(symbol);
  }

  @Post("realtime/signals")
  async getRealtimeSignals(@Body() body: { symbols?: string[] }) {
    const symbols = body.symbols?.filter(Boolean) ?? [];
    return symbols.map((symbol) => this.kiwoom.getRealtimeSignal(symbol));
  }

  @Sse("realtime/stream")
  stream(): Observable<MessageEvent> {
    return this.kiwoomEvents.stream();
  }
}
