import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Holding, MarketQuote } from "../entities";
import { KiwoomService } from "./kiwoom.service";
import { NewsService } from "./news.service";
import { TradingService } from "./trading.service";

@Injectable()
export class AgentSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AgentSchedulerService.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @InjectRepository(Holding) private readonly holdingRepository: Repository<Holding>,
    @InjectRepository(MarketQuote) private readonly marketQuoteRepository: Repository<MarketQuote>,
    @Inject(KiwoomService) private readonly kiwoom: KiwoomService,
    @Inject(TradingService) private readonly trading: TradingService,
    @Inject(NewsService) private readonly news: NewsService,
  ) {}

  async onModuleInit() {
    await this.trading.ensurePortfolioState();
    this.logger.log("Agent scheduler initialized.");
  }

  @Cron(process.env.MARKET_POLL_CRON ?? "*/10 * * * *", { name: "marketPoll" })
  async runMarketCycle() {
    const symbols = (this.config.get<string>("WATCH_SYMBOLS") ?? "")
      .split(",")
      .map((symbol) => symbol.trim())
      .filter(Boolean);

    if (symbols.length === 0) {
      return;
    }

    const settledQuotes = await Promise.allSettled(symbols.map((symbol) => this.kiwoom.getQuote(symbol)));
    const quotes = settledQuotes
      .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<KiwoomService["getQuote"]>>> => result.status === "fulfilled")
      .map((result) => result.value);

    const failedCount = settledQuotes.length - quotes.length;
    if (failedCount > 0) {
      this.logger.warn(`Market cycle quote failures=${failedCount}`);
    }
    if (quotes.length === 0) {
      return;
    }
    const holdings = await this.holdingRepository.find();

    for (const quote of quotes) {
      await this.marketQuoteRepository.save({
        symbol: quote.symbol,
        price: quote.price,
        changeRate: quote.changeRate,
        volume: quote.volume,
        asOf: new Date(quote.asOf),
      });
    }

    const decisions = await this.trading.decideTrades({
      quotes: quotes.map((quote) => ({
        symbol: quote.symbol,
        price: quote.price,
        changeRate: quote.changeRate,
        volume: quote.volume,
      })),
      holdings,
    });

    const quoteMap = quotes.reduce<Record<string, number>>((acc, quote) => {
      acc[quote.symbol] = quote.price;
      return acc;
    }, {});

    await this.trading.executeDecisions(decisions, quoteMap);
    this.logger.log(`Market cycle complete. Quotes=${quotes.length}, Decisions=${decisions.length}`);
  }

  @Cron(process.env.NEWS_SCRAPE_CRON ?? "0 * * * *", { name: "newsScrape" })
  async runNewsCycle() {
    const news = await this.news.scrapeLatestNews();
    await this.news.refineStrategyWithNews();
    this.logger.log(`News cycle complete. Articles=${news.length}`);
  }
}
