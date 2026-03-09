import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { ApiCallLog, GeminiCallLog, Holding, MarketQuote, NewsArticle, PortfolioSnapshot, PortfolioState, ReportRun, TradeLog } from "../entities";
import { UniverseService } from "./universe.service";
import { ApiLogsQueryDto } from "../dto/api-logs.dto";
import { LlmLogsQueryDto } from "../dto/llm-logs.dto";
import { NewsLogsQueryDto } from "../dto/news-logs.dto";
import { ReportsQueryDto } from "../dto/reports.dto";
import { TradeLogsQueryDto } from "../dto/trade-logs.dto";
import { KiwoomService } from "./kiwoom.service";

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @InjectRepository(ApiCallLog) private readonly apiCallLogRepository: Repository<ApiCallLog>,
    @InjectRepository(GeminiCallLog) private readonly geminiCallLogRepository: Repository<GeminiCallLog>,
    @InjectRepository(NewsArticle) private readonly newsArticleRepository: Repository<NewsArticle>,
    @InjectRepository(TradeLog) private readonly tradeLogRepository: Repository<TradeLog>,
    @InjectRepository(PortfolioSnapshot) private readonly portfolioSnapshotRepository: Repository<PortfolioSnapshot>,
    @InjectRepository(Holding) private readonly holdingRepository: Repository<Holding>,
    @InjectRepository(MarketQuote) private readonly marketQuoteRepository: Repository<MarketQuote>,
    @InjectRepository(PortfolioState) private readonly portfolioStateRepository: Repository<PortfolioState>,
    @InjectRepository(ReportRun) private readonly reportRunRepository: Repository<ReportRun>,
    @Inject(UniverseService) private readonly universeService: UniverseService,
    @Inject(KiwoomService) private readonly kiwoomService: KiwoomService,
  ) {}

  async getApiCallLogs(query: ApiLogsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.apiCallLogRepository.createQueryBuilder("log");
    this.applyTimeRange(qb, "log", query.from, query.to);
    if (query.endpoint) {
      qb.andWhere("log.endpoint ILIKE :endpoint", { endpoint: `%${query.endpoint}%` });
    }
    if (query.status) {
      qb.andWhere("log.success = :success", { success: query.status === "success" });
    }
    qb.orderBy("log.createdAt", "DESC").skip((page - 1) * pageSize).take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async getNewsLogs(query: NewsLogsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.newsArticleRepository.createQueryBuilder("news");
    this.applyTimeRange(qb, "news", query.from, query.to);
    qb.orderBy("news.createdAt", "DESC").skip((page - 1) * pageSize).take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async getLlmCallLogs(query: LlmLogsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.geminiCallLogRepository.createQueryBuilder("log");
    this.applyTimeRange(qb, "log", query.from, query.to);
    if (query.model) {
      qb.andWhere("log.model ILIKE :model", { model: `%${query.model}%` });
    }
    if (query.status) {
      qb.andWhere("log.success = :success", { success: query.status === "success" });
    }
    qb.orderBy("log.createdAt", "DESC").skip((page - 1) * pageSize).take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async getTradeLogs(query: TradeLogsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.tradeLogRepository.createQueryBuilder("trade");
    this.applyTimeRange(qb, "trade", query.from, query.to);
    if (query.symbol) {
      qb.andWhere("trade.symbol ILIKE :symbol", { symbol: `%${query.symbol}%` });
    }
    if (query.side) {
      qb.andWhere("trade.side = :side", { side: query.side });
    }
    if (query.status) {
      qb.andWhere("trade.status = :status", { status: query.status });
    }
    qb.orderBy("trade.createdAt", "DESC").skip((page - 1) * pageSize).take(pageSize);
    const [items, total] = await qb.getManyAndCount();

    const entryMap = new Map((await this.universeService.getEntries()).map((entry) => [entry.symbol, entry.name]));
    const enriched = items.map((item) => ({
      ...item,
      name: entryMap.get(item.symbol) ?? null,
      status: item.status ?? (item.mode === "VIRTUAL" ? "EXECUTED" : "ORDER_REQUESTED"),
    }));

    return { items: enriched, total, page, pageSize };
  }

  async getAssetTimeline(query: NewsLogsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const isVirtualMode = (this.config.get<string>("VIRTUAL_TRADING_MODE") ?? "true").toLowerCase() === "true";
    const qb = this.portfolioSnapshotRepository.createQueryBuilder("snap");
    this.applyTimeRange(qb, "snap", query.from, query.to);
    qb.orderBy("snap.createdAt", "DESC").skip((page - 1) * pageSize).take(pageSize);

    const [items, total, state] = await Promise.all([
      qb.getMany(),
      qb.getCount(),
      this.portfolioStateRepository.findOne({ where: { id: "default" } }),
    ]);

    const account = isVirtualMode ? null : await this.kiwoomService.getAccountEvaluation({});
    const holdings = isVirtualMode
      ? await this.holdingRepository.find({ order: { symbol: "ASC" } })
      : (account?.holdings ?? []).map((holding) => ({
          id: holding.symbol,
          symbol: holding.symbol,
          quantity: holding.quantity,
          avgPrice: holding.avgPrice,
        }));

    const symbols = holdings.map((holding) => holding.symbol);
    const latestQuotes =
      symbols.length === 0
        ? []
        : await this.marketQuoteRepository
            .createQueryBuilder("quote")
            .distinctOn(["quote.symbol"])
            .where("quote.symbol IN (:...symbols)", { symbols })
            .orderBy("quote.symbol", "ASC")
            .addOrderBy("quote.asOf", "DESC")
            .addOrderBy("quote.createdAt", "DESC")
            .getMany();
    const quoteMap = new Map(latestQuotes.map((quote) => [quote.symbol, quote.price]));
    const realtimeMap = new Map(
      symbols
        .map((symbol) => {
          const realtime = this.kiwoomService.getRealtimePrice(symbol);
          return realtime ? ([symbol, realtime.price] as const) : null;
        })
        .filter((entry): entry is readonly [string, number] => entry !== null),
    );

    const entryMap = new Map((await this.universeService.getEntries()).map((entry) => [entry.symbol, entry.name]));
    const holdingsWithNames = holdings.map((holding) => ({
      ...holding,
      name: entryMap.get(holding.symbol) ?? null,
      currentPrice: realtimeMap.get(holding.symbol) ?? quoteMap.get(holding.symbol) ?? null,
      currentValue:
        (realtimeMap.get(holding.symbol) ?? quoteMap.get(holding.symbol) ?? holding.avgPrice) * holding.quantity,
    }));

    return {
      timeline: { items, total, page, pageSize },
      summary: {
        cash: isVirtualMode ? (state?.cash ?? 0) : (account?.cash ?? 0),
        initialCapital: state?.initialCapital ?? 0,
        holdings: holdingsWithNames,
      },
    };
  }

  async refreshHoldingQuotes() {
    const isVirtualMode = (this.config.get<string>("VIRTUAL_TRADING_MODE") ?? "true").toLowerCase() === "true";
    if (isVirtualMode) {
      const holdings = await this.holdingRepository.find({ order: { symbol: "ASC" } });
      const symbols = holdings.map((holding) => holding.symbol);
      if (symbols.length === 0) {
        return { ok: true, refreshed: 0, symbols: [], errors: [] as string[] };
      }

      try {
        await this.kiwoomService.registerRealtimeQuotes(symbols, ["0B", "0D"]);
      } catch (error) {
        this.logger.warn(`Failed to register realtime quotes: ${String(error)}`);
      }

      const settled = await Promise.allSettled(symbols.map((symbol) => this.kiwoomService.getQuote(symbol)));
      const items = settled
        .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<KiwoomService["getQuote"]>>> => result.status === "fulfilled")
        .map((result) => result.value);
      const errors = settled
        .map((result, idx) => (result.status === "rejected" ? `${symbols[idx]}: ${String(result.reason)}` : null))
        .filter((value): value is string => Boolean(value));

      for (const quote of items) {
        await this.marketQuoteRepository.save({
          symbol: quote.symbol,
          price: quote.price,
          changeRate: quote.changeRate,
          volume: quote.volume,
          asOf: new Date(quote.asOf),
        });
      }

      return {
        ok: errors.length === 0,
        refreshed: items.length,
        symbols,
        errors,
      };
    }

    const account = await this.kiwoomService.getAccountEvaluation({});
    const holdings = account.holdings ?? [];
    const symbols = holdings.map((holding) => holding.symbol);
    if (symbols.length === 0) {
      return { ok: true, refreshed: 0, symbols: [], errors: [] as string[] };
    }

    try {
      await this.kiwoomService.registerRealtimeQuotes(symbols, ["0B", "0D"]);
    } catch (error) {
      this.logger.warn(`Failed to register realtime quotes: ${String(error)}`);
    }

    for (const holding of holdings) {
      if (!holding.symbol || !holding.price) {
        continue;
      }
      await this.marketQuoteRepository.save({
        symbol: holding.symbol,
        price: holding.price,
        changeRate: holding.profitRate ?? 0,
        volume: 0,
        asOf: new Date().toISOString(),
      });
    }

    return {
      ok: true,
      refreshed: holdings.length,
      symbols,
      errors: [] as string[],
    };
  }

  async getReports(query: ReportsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.reportRunRepository.createQueryBuilder("report");
    this.applyTimeRange(qb, "report", query.from, query.to);
    qb.orderBy("report.createdAt", "DESC").skip((page - 1) * pageSize).take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async getReport(id: string) {
    return this.reportRunRepository.findOne({ where: { id } });
  }

  async refreshTradeStatuses() {
    const isVirtualMode = (this.config.get<string>("VIRTUAL_TRADING_MODE") ?? "true").toLowerCase() === "true";
    if (isVirtualMode) {
      return {
        ok: false,
        updated: 0,
        pending: 0,
        message: "Trade status refresh is only available in API trading mode.",
      };
    }

    const account = await this.kiwoomService.getAccountEvaluation({});
    const qtyBySymbol = new Map((account.holdings ?? []).map((holding) => [holding.symbol, holding.quantity]));
    const staleMinutes = Number(this.config.get<string>("TRADE_STATUS_STALE_MINUTES") ?? "10");
    const staleMs = Math.max(1, staleMinutes) * 60_000;
    const now = Date.now();
    const pendingLogs = await this.tradeLogRepository.find({
      where: [{ mode: "API", status: "ORDER_REQUESTED" }, { mode: "API", status: IsNull() }],
      order: { createdAt: "ASC" },
      take: 500,
    });

    let updated = 0;
    for (const log of pendingLogs) {
      const currentQty = qtyBySymbol.get(log.symbol) ?? 0;
      const isStale = now - new Date(log.createdAt).getTime() >= staleMs;
      let nextStatus: "ORDER_REQUESTED" | "EXECUTED" | "PARTIALLY_FILLED" | "NOT_FILLED" =
        log.status === "ORDER_REQUESTED" ? "ORDER_REQUESTED" : "ORDER_REQUESTED";

      if (log.accountQtyBefore == null) {
        nextStatus = isStale ? "NOT_FILLED" : "ORDER_REQUESTED";
      } else if (log.side === "BUY") {
        const filled = Math.max(0, currentQty - log.accountQtyBefore);
        if (filled >= log.quantity) {
          nextStatus = "EXECUTED";
        } else if (filled > 0) {
          nextStatus = "PARTIALLY_FILLED";
        } else {
          nextStatus = isStale ? "NOT_FILLED" : "ORDER_REQUESTED";
        }
      } else if (log.side === "SELL") {
        const filled = Math.max(0, log.accountQtyBefore - currentQty);
        if (filled >= log.quantity) {
          nextStatus = "EXECUTED";
        } else if (filled > 0) {
          nextStatus = "PARTIALLY_FILLED";
        } else {
          nextStatus = isStale ? "NOT_FILLED" : "ORDER_REQUESTED";
        }
      }

      if (nextStatus !== log.status) {
        await this.tradeLogRepository.update({ id: log.id }, { status: nextStatus });
        updated += 1;
      }
    }

    return {
      ok: true,
      updated,
      pending: pendingLogs.length - updated,
      staleMinutes,
    };
  }

  private applyTimeRange(qb: any, alias: string, from?: string, to?: string) {
    if (from) {
      qb.andWhere(`${alias}.createdAt >= :from`, { from: new Date(from).toISOString() });
    }
    if (to) {
      qb.andWhere(`${alias}.createdAt <= :to`, { to: new Date(to).toISOString() });
    }
  }
}
