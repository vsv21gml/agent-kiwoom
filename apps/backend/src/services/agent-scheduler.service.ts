import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { CronJob } from "cron";
import { Repository } from "typeorm";
import { Holding, MarketQuote, PortfolioSnapshot, ReportRun } from "../entities";
import { KiwoomService } from "./kiwoom.service";
import { MonitoringEventsService } from "./monitoring-events.service";
import { NewsService } from "./news.service";
import { StrategyService } from "./strategy.service";
import { TradingService } from "./trading.service";
import { UniverseService } from "./universe.service";

@Injectable()
export class AgentSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AgentSchedulerService.name);
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(SchedulerRegistry) private readonly schedulerRegistry: SchedulerRegistry,
    @InjectRepository(Holding) private readonly holdingRepository: Repository<Holding>,
    @InjectRepository(MarketQuote) private readonly marketQuoteRepository: Repository<MarketQuote>,
    @InjectRepository(ReportRun) private readonly reportRunRepository: Repository<ReportRun>,
    @InjectRepository(PortfolioSnapshot)
    private readonly portfolioSnapshotRepository: Repository<PortfolioSnapshot>,
    @Inject(KiwoomService) private readonly kiwoom: KiwoomService,
    @Inject(TradingService) private readonly trading: TradingService,
    @Inject(MonitoringEventsService) private readonly monitoringEvents: MonitoringEventsService,
    @Inject(UniverseService) private readonly universeService: UniverseService,
    @Inject(NewsService) private readonly news: NewsService,
    @Inject(StrategyService) private readonly strategyService: StrategyService,
  ) {}

  async onModuleInit() {
    await this.trading.ensurePortfolioState();
    void this.refreshUniverse();
    this.registerCronJobs();
    this.logger.log("Agent scheduler initialized.");
  }

  private registerCronJobs() {
    const marketCron = this.config.get<string>("MARKET_POLL_CRON") ?? "*/10 * * * *";
    const newsCron = this.config.get<string>("NEWS_SCRAPE_CRON") ?? "0 * * * *";
    const universeCron = this.config.get<string>("UNIVERSE_REFRESH_CRON") ?? "0 6 * * *";

    const marketJob = new CronJob(marketCron, () => {
      void this.runMarketCycle();
    });
    const newsJob = new CronJob(newsCron, () => {
      void this.runNewsCycle();
    });
    const universeJob = new CronJob(universeCron, () => {
      void this.refreshUniverse();
    });

    this.schedulerRegistry.addCronJob("marketPoll", marketJob);
    this.schedulerRegistry.addCronJob("newsScrape", newsJob);
    this.schedulerRegistry.addCronJob("universeRefresh", universeJob);

    marketJob.start();
    newsJob.start();
    universeJob.start();

    this.logger.log(
      `Cron registered: marketPoll=${marketCron}, newsScrape=${newsCron}, universeRefresh=${universeCron}`,
    );
  }

  async runMarketCycle(): Promise<string> {
    const startedAt = Date.now();
    const runId = `market-${new Date().toISOString()}`;
    this.logger.log(`[${runId}] Market cycle start`);

    try {
      if (!this.isMarketOpenNow()) {
        this.logger.log(`[${runId}] Market closed (KRX hours). Skipping cycle.`);
        return runId;
      }

      const universe = await this.resolveUniverseSelection();
      const symbols = universe.symbols;
      if (symbols.length === 0) {
        this.logger.warn(`[${runId}] No symbols resolved for trading. Skipping cycle.`);
        return runId;
      }

      this.logger.log(
        `[${runId}] Symbols=${symbols.join(",")}`,
      );

      try {
        await this.kiwoom.registerRealtimeQuotes(symbols, ["0B", "0D"]);
      } catch (error) {
        this.logger.warn(`[${runId}] Realtime register failed: ${String(error)}`);
      }
      this.logger.log(`[${runId}] Fetching quotes...`);
      const settledQuotes = await Promise.allSettled(symbols.map((symbol) => this.kiwoom.getQuote(symbol)));
      const quotes = settledQuotes
        .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<KiwoomService["getQuote"]>>> => result.status === "fulfilled")
        .map((result) => result.value);

      const failedCount = settledQuotes.length - quotes.length;
      if (failedCount > 0) {
        this.logger.warn(`[${runId}] Quote failures=${failedCount}`);
      }
      if (quotes.length === 0) {
        this.logger.warn(`[${runId}] No quotes returned. Skipping cycle.`);
        return runId;
      }

      const mergedQuotes = this.kiwoom.applyRealtimeToQuotes(quotes);
      const holdings = await this.holdingRepository.find();
      this.logger.log(`[${runId}] Quotes=${mergedQuotes.length} Holdings=${holdings.length}`);

      for (const quote of mergedQuotes) {
        await this.marketQuoteRepository.save({
          symbol: quote.symbol,
          price: quote.price,
          changeRate: quote.changeRate,
          volume: quote.volume,
          asOf: new Date(quote.asOf),
        });
      }

      this.logger.log(`[${runId}] Decision start (Gemini + fallback)`);
      const decisionStartedAt = Date.now();
      const decisions = await this.trading.decideTrades({
        quotes: mergedQuotes.map((quote) => ({
          symbol: quote.symbol,
          price: quote.price,
          changeRate: quote.changeRate,
          volume: quote.volume,
        })),
        holdings,
      });
      this.logger.log(`[${runId}] Decision complete in ${Date.now() - decisionStartedAt}ms`);

      const decisionSummary = decisions
        .map((decision) => `${decision.side}:${decision.symbol}x${decision.quantity}`)
        .join(", ");
      this.logger.log(
        `[${runId}] Decisions=${decisions.length}${decisionSummary ? ` [${decisionSummary}]` : ""}`,
      );

      const quoteMap = mergedQuotes.reduce<Record<string, number>>((acc, quote) => {
        acc[quote.symbol] = quote.price;
        return acc;
      }, {});

      this.logger.log(`[${runId}] Execute start`);
      const executeStartedAt = Date.now();
      const execution = await this.trading.executeDecisions(decisions, quoteMap);
      this.logger.log(`[${runId}] Execute complete in ${Date.now() - executeStartedAt}ms`);
      const durationMs = Date.now() - startedAt;
      this.logger.log(`[${runId}] Market cycle complete in ${durationMs}ms`);
      await this.saveReport({
        runId,
        durationMs,
        decisions,
        execution,
        universe,
      });
      this.monitoringEvents.emit("report", {
        runId,
        at: new Date().toISOString(),
      });
      this.monitoringEvents.emit("market", {
        runId,
        quotes: quotes.length,
        decisions: decisions.length,
        durationMs,
        at: new Date().toISOString(),
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.logger.error(`[${runId}] Market cycle failed after ${durationMs}ms`, error as Error);
      throw error;
    }

    return runId;
  }

  private isMarketOpenNow() {
    const timezone = this.config.get<string>("MARKET_TIMEZONE") ?? "Asia/Seoul";
    const openTime = this.config.get<string>("MARKET_OPEN_HHMM") ?? "0900";
    const closeTime = this.config.get<string>("MARKET_CLOSE_HHMM") ?? "1530";

    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    const parts = formatter.formatToParts(now);
    const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
    const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
    const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
    const hhmm = `${hour}${minute}`;

    if (["Sat", "Sun"].includes(weekday)) {
      return false;
    }

    return hhmm >= openTime && hhmm <= closeTime;
  }

  async runNewsCycle() {
    const news = await this.news.scrapeLatestNews();
    await this.news.refineStrategyWithNews();
    this.logger.log(`News cycle complete. Articles=${news.length}`);
    this.monitoringEvents.emit("news", {
      articles: news.length,
      at: new Date().toISOString(),
    });
  }

  async runNewsCycleNow() {
    await this.runNewsCycle();
    return { ok: true };
  }

  private async resolveUniverseSelection(): Promise<{
    symbols: string[];
    topMarketCapSymbols: string[];
    topLiquiditySymbols: string[];
    topNewsSymbols: string[];
    holdingsSymbols: string[];
    policy: Awaited<ReturnType<StrategyService["getUniversePolicy"]>>;
  }> {
    const holdings = await this.holdingRepository.find();
    const holdingSymbols = holdings.map((holding) => holding.symbol);

    const fileEntries = await this.universeService.getEntries();
    if (fileEntries.length === 0) {
      const fallback = (this.config.get<string>("WATCH_SYMBOLS") ?? "")
        .split(",")
        .map((symbol) => symbol.trim())
        .filter(Boolean);
      return {
        symbols: Array.from(new Set([...holdingSymbols, ...fallback])),
        topMarketCapSymbols: [],
        topLiquiditySymbols: [],
        topNewsSymbols: [],
        holdingsSymbols: holdingSymbols,
        policy: await this.strategyService.getUniversePolicy(),
      };
    }

    const policy = await this.strategyService.getUniversePolicy();
    const topMarketCap = policy.topMarketCap;
    const topLiquidity = policy.topLiquidity;
    const topNews = policy.topNews;
    const maxUniverse = policy.maxUniverse;
    const liquidityCandidates = Math.max(policy.liquidityCandidates, topMarketCap, topLiquidity);
    const liquidityDays = policy.liquidityDays;

    const marketCapRanked = [...fileEntries]
      .filter((entry) => typeof entry.marketCap === "number" && entry.marketCap > 0)
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    if (marketCapRanked.length === 0) {
      this.logger.warn("Universe file does not include marketCap values. Falling back to WATCH_SYMBOLS.");
      const fallback = (this.config.get<string>("WATCH_SYMBOLS") ?? "")
        .split(",")
        .map((symbol) => symbol.trim())
        .filter(Boolean);
      return {
        symbols: Array.from(new Set([...holdingSymbols, ...fallback])),
        topMarketCapSymbols: [],
        topLiquiditySymbols: [],
        topNewsSymbols: [],
        holdingsSymbols: holdingSymbols,
        policy,
      };
    }
    const topMarketCapSymbols = marketCapRanked.slice(0, topMarketCap).map((entry) => entry.symbol);

    const liquidityCandidatesSymbols = marketCapRanked.slice(0, liquidityCandidates).map((entry) => entry.symbol);
    const liquidityRanked = await this.rankByAverageLiquidity(liquidityCandidatesSymbols, liquidityDays);

    const topLiquiditySymbols = liquidityRanked.slice(0, topLiquidity).map((entry) => entry.symbol);

    const latestNews = await this.news.getLatestNews(50);
    const newsRanked = this.rankByNewsMentions(fileEntries, latestNews);
    const topNewsSymbols = newsRanked.slice(0, topNews).map((entry) => entry.symbol);

    const ordered = [...holdingSymbols, ...topMarketCapSymbols, ...topLiquiditySymbols, ...topNewsSymbols];
    const universe = Array.from(new Set(ordered));
    const trimmed = maxUniverse > 0 && universe.length > maxUniverse ? universe.slice(0, maxUniverse) : universe;
    return {
      symbols: trimmed,
      topMarketCapSymbols,
      topLiquiditySymbols,
      topNewsSymbols,
      holdingsSymbols: holdingSymbols,
      policy,
    };
  }

  private async rankByAverageLiquidity(symbols: string[], days: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(days, 1));

    const quotes = await this.marketQuoteRepository
      .createQueryBuilder("quote")
      .select(["quote.symbol AS symbol", "quote.price AS price", "quote.volume AS volume", "quote.asOf AS asOf"])
      .where("quote.symbol IN (:...symbols)", { symbols })
      .andWhere("quote.asOf >= :cutoff", { cutoff: cutoff.toISOString() })
      .getRawMany<{ symbol: string; price: number; volume: number; asOf: Date }>();

    const dailyMap = new Map<string, Map<string, { maxVolume: number; sumPrice: number; count: number }>>();
    for (const quote of quotes) {
      const asOf = new Date(quote.asOf as unknown as string);
      if (Number.isNaN(asOf.getTime())) {
        continue;
      }
      const day = asOf.toISOString().slice(0, 10);
      const symbolMap = dailyMap.get(quote.symbol) ?? new Map();
      const entry = symbolMap.get(day) ?? { maxVolume: 0, sumPrice: 0, count: 0 };
      entry.maxVolume = Math.max(entry.maxVolume, Number(quote.volume ?? 0));
      entry.sumPrice += Number(quote.price ?? 0);
      entry.count += 1;
      symbolMap.set(day, entry);
      dailyMap.set(quote.symbol, symbolMap);
    }

    const liquidityMap = new Map<string, number>();
    for (const [symbol, dayMap] of dailyMap) {
      let total = 0;
      let daysCount = 0;
      for (const entry of dayMap.values()) {
        const avgPrice = entry.count > 0 ? entry.sumPrice / entry.count : 0;
        total += avgPrice * entry.maxVolume;
        daysCount += 1;
      }
      if (daysCount > 0) {
        liquidityMap.set(symbol, total / daysCount);
      }
    }

    const missing = symbols.filter((symbol) => !liquidityMap.has(symbol));
    if (missing.length > 0) {
      const settledQuotes = await Promise.allSettled(missing.map((symbol) => this.kiwoom.getQuote(symbol)));
      for (const result of settledQuotes) {
        if (result.status === "fulfilled") {
          liquidityMap.set(result.value.symbol, result.value.price * result.value.volume);
        }
      }
    }

    return symbols
      .map((symbol) => ({ symbol, liquidity: liquidityMap.get(symbol) ?? 0 }))
      .sort((a, b) => b.liquidity - a.liquidity);
  }

  private async refreshUniverse() {
    const policy = await this.strategyService.getUniversePolicy();
    const marketMap: Record<string, string> = {
      KOSPI: "0",
      KOSDAQ: "10",
      KONEX: "50",
    };
    const markets = policy.markets.map((market) => marketMap[market] ?? market).filter(Boolean);

    if ((this.config.get<string>("UNIVERSE_SOURCE_URL") ?? "").length > 0) {
      await this.universeService.refreshFromSource();
      return;
    }

    await this.universeService.refreshFromKiwoom({ markets });
  }

  private rankByNewsMentions(
    entries: Array<{ symbol: string; name?: string }>,
    latestNews: Array<{ title?: string | null; summary?: string | null }>,
  ) {
    const normalizedArticles = latestNews.map((article) => ({
      title: article.title ?? "",
      summary: article.summary ?? "",
    }));

    return entries
      .map((entry) => {
        const symbol = entry.symbol;
        const name = entry.name ?? "";
        let mentions = 0;

        for (const article of normalizedArticles) {
          const text = `${article.title} ${article.summary}`.toLowerCase();
          const symbolHit = symbol && text.includes(symbol.toLowerCase());
          const nameHit = name && text.includes(name.toLowerCase());
          if (symbolHit || nameHit) {
            mentions += 1;
          }
        }

        return { symbol, mentions };
      })
      .sort((a, b) => b.mentions - a.mentions);
  }

  private async saveReport(input: {
    runId: string;
    durationMs: number;
    decisions: Array<{ symbol: string; side: string; quantity: number; reason?: string; confidence?: number }>;
    execution: Awaited<ReturnType<TradingService["executeDecisions"]>>;
    universe: {
      symbols: string[];
      topMarketCapSymbols: string[];
      topLiquiditySymbols: string[];
      topNewsSymbols: string[];
      holdingsSymbols: string[];
      policy: Awaited<ReturnType<StrategyService["getUniversePolicy"]>>;
    };
  }) {
    const buyCount = input.execution.executed.filter((item) => item.side === "BUY").length;
    const sellCount = input.execution.executed.filter((item) => item.side === "SELL").length;
    const tradeCount = input.execution.executed.length;
    const decisionCount = input.decisions.length;
    const universeSize = input.universe.symbols.length;

    const entries = await this.universeService.getEntries();
    const nameMap = new Map(entries.map((entry) => [entry.symbol, entry.name ?? ""]));
    const assetDelta = await this.computeAssetDelta(input.execution.totalAsset);
    const reportText = this.buildReportText(input, nameMap);

    await this.reportRunRepository.save({
      runId: input.runId,
      totalAsset: input.execution.totalAsset,
      holdingsValue: input.execution.holdingsValue,
      cash: input.execution.cash,
      assetDelta,
      buyCount,
      sellCount,
      tradeCount,
      decisionCount,
      universeSize,
      reportText,
    });
  }

  private buildReportText(
    input: {
      runId: string;
      durationMs: number;
      decisions: Array<{ symbol: string; side: string; quantity: number; reason?: string; confidence?: number }>;
    execution: Awaited<ReturnType<TradingService["executeDecisions"]>>;
    universe: {
      symbols: string[];
      topMarketCapSymbols: string[];
      topLiquiditySymbols: string[];
      topNewsSymbols: string[];
      holdingsSymbols: string[];
      policy: Awaited<ReturnType<StrategyService["getUniversePolicy"]>>;
    };
  },
    nameMap: Map<string, string>,
  ) {
    const lines: string[] = [];
    const policy = input.universe.policy;
    const label = (symbol: string) => {
      const name = nameMap.get(symbol);
      return name ? `${name}(${symbol})` : symbol;
    };
    lines.push(`Run: ${input.runId}`);
    lines.push(`Duration: ${input.durationMs}ms`);
    lines.push("");
    lines.push("Universe Selection");
    lines.push(`- Markets: ${policy.markets.join(", ")}`);
    lines.push(`- Top Market Cap: ${policy.topMarketCap}`);
    lines.push(`- Top Liquidity: ${policy.topLiquidity} (days=${policy.liquidityDays})`);
    lines.push(`- Top News: ${policy.topNews}`);
    lines.push(`- Max Universe: ${policy.maxUniverse}`);
    lines.push(`- Universe Size: ${input.universe.symbols.length}`);
    lines.push("");
    lines.push("Universe Picks");
    lines.push(`- Holdings Included: ${input.universe.holdingsSymbols.join(", ") || "-"}`);
    lines.push(`- Market Cap Picks: ${input.universe.topMarketCapSymbols.slice(0, 20).join(", ") || "-"}`);
    lines.push(`- Liquidity Picks: ${input.universe.topLiquiditySymbols.slice(0, 20).join(", ") || "-"}`);
    lines.push(`- News Picks: ${input.universe.topNewsSymbols.slice(0, 20).join(", ") || "-"}`);
    lines.push("");
    lines.push("Decisions");
    if (input.decisions.length === 0) {
      lines.push("- No trade decisions.");
    } else {
      for (const decision of input.decisions) {
        const confidence = decision.confidence ?? 0;
        lines.push(
          `- ${decision.side} ${label(decision.symbol)} x${decision.quantity} (confidence=${confidence.toFixed(
            2,
          )}) reason=${decision.reason ?? "n/a"}`,
        );
      }
    }
    lines.push("");
    lines.push("Executed Trades");
    if (input.execution.executed.length === 0) {
      lines.push("- None");
    } else {
      for (const trade of input.execution.executed) {
        lines.push(
          `- ${trade.side} ${label(trade.symbol)} x${trade.quantity} @ ${trade.price} total=${trade.totalAmount} reason=${trade.reason ?? "n/a"}`,
        );
      }
    }
    lines.push("");
    lines.push("Skipped Trades");
    if (input.execution.skipped.length === 0) {
      lines.push("- None");
    } else {
      for (const trade of input.execution.skipped) {
        lines.push(
          `- ${trade.side} ${label(trade.symbol)} x${trade.quantity} @ ${trade.price} status=${trade.status} reason=${trade.reason ?? "n/a"}`,
        );
      }
    }
    lines.push("");
    lines.push("Portfolio Snapshot");
    lines.push(`- Cash: ${input.execution.cash}`);
    lines.push(`- Holdings Value (Unrealized): ${input.execution.holdingsValue}`);
    lines.push(`- Total Asset: ${input.execution.totalAsset}`);

    return lines.join("\n");
  }

  private async computeAssetDelta(currentTotal: number) {
    const latest = await this.portfolioSnapshotRepository.find({
      order: { createdAt: "DESC" },
      take: 2,
    });
    const previous = latest.length > 1 ? latest[1] : null;
    if (!previous) {
      return 0;
    }
    return currentTotal - previous.totalAsset;
  }
}
