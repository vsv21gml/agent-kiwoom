import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Holding, PortfolioSnapshot, PortfolioState, TradeLog } from "../entities";
import { TradeDecision } from "../types";
import { GeminiService } from "./gemini.service";
import { KiwoomService } from "./kiwoom.service";
import { NewsService } from "./news.service";
import { StrategyService } from "./strategy.service";
import { UniverseService } from "./universe.service";

@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @InjectRepository(PortfolioState)
    private readonly portfolioStateRepository: Repository<PortfolioState>,
    @InjectRepository(Holding) private readonly holdingRepository: Repository<Holding>,
    @InjectRepository(TradeLog) private readonly tradeLogRepository: Repository<TradeLog>,
    @InjectRepository(PortfolioSnapshot)
    private readonly portfolioSnapshotRepository: Repository<PortfolioSnapshot>,
    @Inject(GeminiService) private readonly gemini: GeminiService,
    @Inject(KiwoomService) private readonly kiwoom: KiwoomService,
    @Inject(NewsService) private readonly newsService: NewsService,
    @Inject(StrategyService) private readonly strategyService: StrategyService,
    @Inject(UniverseService) private readonly universeService: UniverseService,
  ) {}

  async ensurePortfolioState() {
    const existing = await this.portfolioStateRepository.findOne({ where: { id: "default" } });
    if (existing) {
      return existing;
    }

    const initialCapital = Number(this.config.get<string>("INITIAL_CAPITAL") ?? "1000000");
    const virtualMode = (this.config.get<string>("VIRTUAL_TRADING_MODE") ?? "true") === "true";

    return this.portfolioStateRepository.save({
      id: "default",
      initialCapital,
      cash: initialCapital,
      virtualMode,
    });
  }

  async decideTrades(context: {
    quotes: Array<{ symbol: string; price: number; changeRate: number; volume: number }>;
    holdings: Holding[];
  }): Promise<TradeDecision[]> {
    const strategy = await this.strategyService.getCurrentStrategy();
    const state = await this.ensurePortfolioState();
    const policy = await this.strategyService.getTradingPolicy();
    const fallback = this.ruleBasedDecisions(context.quotes, context.holdings);
    const latestNews = await this.newsService.getLatestNews(20);
    const newsSignals = await this.buildNewsSignals(context.quotes, latestNews);
    const realtimeSignals = context.quotes.map((quote) => this.kiwoom.getRealtimeSignal(quote.symbol));

    const prompt = [
      "Return JSON array only.",
      "Each item: {symbol, side(BUY|SELL|HOLD), quantity, reason, confidence}",
      "Use short-term strategy and current holdings.",
      `Cash available: ${state.cash}`,
      `Trading policy: ${JSON.stringify(policy)}`,
      `Strategy markdown:\n${strategy}`,
      `Holdings:${JSON.stringify(context.holdings)}`,
      `Quotes:${JSON.stringify(context.quotes)}`,
      `Latest news:${JSON.stringify(latestNews)}`,
      `News signals:${JSON.stringify(newsSignals)}`,
      `Realtime signals:${JSON.stringify(realtimeSignals)}`,
    ].join("\n\n");

    const ai = await this.gemini.generateJson<TradeDecision[]>(prompt, fallback);
    return ai.filter((item) => item.side !== "HOLD" && item.quantity > 0);
  }

  private async buildNewsSignals(
    quotes: Array<{ symbol: string; price: number; changeRate: number; volume: number }>,
    latestNews: Array<{ title?: string | null; summary?: string | null; source?: string | null; publishedAt?: Date | null }>,
  ) {
    const entries = await this.universeService.getEntries();
    const entryMap = new Map(entries.map((entry) => [entry.symbol, entry]));
    const normalizedArticles = latestNews.map((article) => ({
      title: article.title ?? "",
      summary: article.summary ?? "",
      source: article.source ?? "",
    }));

    return quotes.map((quote) => {
      const entry = entryMap.get(quote.symbol);
      const name = entry?.name ?? "";
      const symbol = quote.symbol;
      let mentions = 0;
      const matchedTitles: string[] = [];

      for (const article of normalizedArticles) {
        const text = `${article.title} ${article.summary}`.toLowerCase();
        const symbolHit = symbol && text.includes(symbol.toLowerCase());
        const nameHit = name && text.includes(name.toLowerCase());
        if (symbolHit || nameHit) {
          mentions += 1;
          if (article.title) {
            matchedTitles.push(article.title);
          }
        }
      }

      return {
        symbol,
        name: name || undefined,
        mentions,
        sampleTitles: matchedTitles.slice(0, 3),
      };
    });
  }

  async executeDecisions(decisions: TradeDecision[], quoteMap: Record<string, number>) {
    const executed: Array<{
      symbol: string;
      side: "BUY" | "SELL";
      quantity: number;
      price: number;
      totalAmount: number;
      reason?: string;
      status: "EXECUTED";
    }> = [];
    const skipped: Array<{
      symbol: string;
      side: "BUY" | "SELL";
      quantity: number;
      price: number;
      totalAmount: number;
      reason?: string;
      status:
        | "SKIPPED_INSUFFICIENT_CASH"
        | "SKIPPED_INSUFFICIENT_HOLDING"
        | "SKIPPED_DUPLICATE_SYMBOL"
        | "SKIPPED_POLICY";
    }> = [];

    if (decisions.length === 0) {
      await this.snapshotAsset(quoteMap);
      const holdingsValue = await this.calculateHoldingsValue(quoteMap);
      const state = await this.ensurePortfolioState();
      return {
        executed,
        skipped,
        cash: state.cash,
        holdingsValue,
        totalAsset: state.cash + holdingsValue,
      };
    }

    const state = await this.ensurePortfolioState();
    const policy = await this.strategyService.getTradingPolicy();
    const holdingsValueForSizing = await this.calculateHoldingsValue(quoteMap);
    const totalAssetForSizing = state.cash + holdingsValueForSizing;
    const maxPositionValue =
      policy.positionSizePct > 0 ? (totalAssetForSizing * policy.positionSizePct) / 100 : 0;
    const virtualMode = state.virtualMode;
    const processedSymbols = new Set<string>();

    for (const decision of decisions) {
      if (decision.side === "HOLD") {
        continue;
      }
      const price = this.resolveExecutionPrice(decision.symbol, quoteMap);
      const totalAmount = decision.quantity * price;
      if (processedSymbols.has(decision.symbol)) {
        this.logger.warn(`Skip ${decision.side} ${decision.symbol}: duplicate symbol in same cycle`);
        skipped.push({
          symbol: decision.symbol,
          side: decision.side,
          quantity: decision.quantity,
          price,
          totalAmount,
          reason: decision.reason,
          status: "SKIPPED_DUPLICATE_SYMBOL",
        });
        continue;
      }
      processedSymbols.add(decision.symbol);

      if (decision.side === "BUY") {
        if (price <= 0) {
          this.logger.warn(`Skip BUY ${decision.symbol}: invalid price=${price}`);
          skipped.push({
            symbol: decision.symbol,
            side: "BUY",
            quantity: decision.quantity,
            price,
            totalAmount,
            reason: decision.reason,
            status: "SKIPPED_INSUFFICIENT_CASH",
          });
          continue;
        }

        const maxAffordable = Math.floor(state.cash / price);
        const maxByPolicy = maxPositionValue > 0 ? Math.floor(maxPositionValue / price) : maxAffordable;
        if (maxAffordable <= 0) {
          this.logger.warn(`Skip BUY ${decision.symbol}: insufficient cash`);
          skipped.push({
            symbol: decision.symbol,
            side: "BUY",
            quantity: decision.quantity,
            price,
            totalAmount,
            reason: decision.reason,
            status: "SKIPPED_INSUFFICIENT_CASH",
          });
          continue;
        }

        const finalQuantity = Math.min(decision.quantity, maxAffordable, maxByPolicy);
        if (finalQuantity <= 0) {
          this.logger.warn(`Skip BUY ${decision.symbol}: position size policy limit`);
          skipped.push({
            symbol: decision.symbol,
            side: "BUY",
            quantity: decision.quantity,
            price,
            totalAmount,
            reason: `${decision.reason ?? ""} (position cap ${policy.positionSizePct}%)`.trim(),
            status: "SKIPPED_POLICY",
          });
          continue;
        }
        const finalTotal = finalQuantity * price;
        if (finalQuantity < decision.quantity) {
          this.logger.warn(
            `Reduce BUY ${decision.symbol}: requested=${decision.quantity}, affordable=${finalQuantity}`,
          );
        }

        if (!virtualMode) {
          await this.kiwoom.placeOrder({
            symbol: decision.symbol,
            side: "BUY",
            quantity: finalQuantity,
            price,
          });
        }

        state.cash -= finalTotal;
        await this.upsertHoldingBuy(decision.symbol, finalQuantity, price);
        const adjustedReason =
          finalQuantity < decision.quantity
            ? `${decision.reason ?? ""} (auto-resized from ${decision.quantity} to ${finalQuantity})`.trim()
            : decision.reason;
        await this.tradeLogRepository.save({
          symbol: decision.symbol,
          side: "BUY",
          quantity: finalQuantity,
          price,
          totalAmount: finalTotal,
          reason: adjustedReason,
          mode: virtualMode ? "VIRTUAL" : "REAL",
        });
        executed.push({
          symbol: decision.symbol,
          side: "BUY",
          quantity: finalQuantity,
          price,
          totalAmount: finalTotal,
          reason: adjustedReason,
          status: "EXECUTED",
        });
      }

      if (decision.side === "SELL") {
        const holding = await this.holdingRepository.findOne({ where: { symbol: decision.symbol } });
        if (!holding || holding.quantity < decision.quantity) {
          this.logger.warn(`Skip SELL ${decision.symbol}: insufficient holding`);
          skipped.push({
            symbol: decision.symbol,
            side: "SELL",
            quantity: decision.quantity,
            price,
            totalAmount,
            reason: decision.reason,
            status: "SKIPPED_INSUFFICIENT_HOLDING",
          });
          continue;
        }

        const profitPct = holding.avgPrice > 0 ? ((price - holding.avgPrice) / holding.avgPrice) * 100 : 0;
        if (profitPct < policy.takeProfitPct && profitPct > policy.stopLossPct) {
          this.logger.warn(
            `Skip SELL ${decision.symbol}: profit ${profitPct.toFixed(3)}% not beyond take/stop rules`,
          );
          skipped.push({
            symbol: decision.symbol,
            side: "SELL",
            quantity: decision.quantity,
            price,
            totalAmount,
            reason: `${decision.reason ?? ""} (policy take=${policy.takeProfitPct}%, stop=${policy.stopLossPct}%)`.trim(),
            status: "SKIPPED_POLICY",
          });
          continue;
        }

        if (!virtualMode) {
          await this.kiwoom.placeOrder({
            symbol: decision.symbol,
            side: "SELL",
            quantity: decision.quantity,
            price,
          });
        }

        state.cash += totalAmount;
        const pnl = (price - holding.avgPrice) * decision.quantity;
        await this.upsertHoldingSell(decision.symbol, decision.quantity);
        await this.tradeLogRepository.save({
          symbol: decision.symbol,
          side: "SELL",
          quantity: decision.quantity,
          price,
          totalAmount,
          reason: decision.reason,
          mode: virtualMode ? "VIRTUAL" : "REAL",
          realizedPnl: pnl,
        });
        executed.push({
          symbol: decision.symbol,
          side: "SELL",
          quantity: decision.quantity,
          price,
          totalAmount,
          reason: decision.reason,
          status: "EXECUTED",
        });
      }
    }

    await this.portfolioStateRepository.save(state);

    await this.snapshotAsset(quoteMap);
    const holdingsValue = await this.calculateHoldingsValue(quoteMap);
    return {
      executed,
      skipped,
      cash: state.cash,
      holdingsValue,
      totalAsset: state.cash + holdingsValue,
    };
  }

  async snapshotAsset(quoteMap: Record<string, number>) {
    const [state, holdings] = await Promise.all([
      this.ensurePortfolioState(),
      this.holdingRepository.find(),
    ]);

    const holdingsValue = holdings.reduce((acc, holding) => {
      const price = quoteMap[holding.symbol] ?? holding.avgPrice;
      return acc + price * holding.quantity;
    }, 0);

    const totalAsset = state.cash + holdingsValue;
    await this.portfolioSnapshotRepository.save({
      cash: state.cash,
      holdingsValue,
      totalAsset,
    });
  }

  private ruleBasedDecisions(
    quotes: Array<{ symbol: string; price: number; changeRate: number; volume: number }>,
    holdings: Holding[],
  ): TradeDecision[] {
    const decisions: TradeDecision[] = [];

    for (const quote of quotes) {
      const holding = holdings.find((h) => h.symbol === quote.symbol);
      if (holding && quote.changeRate >= 2.5) {
        decisions.push({
          symbol: quote.symbol,
          side: "SELL",
          quantity: Math.max(1, Math.floor(holding.quantity / 2)),
          reason: "Fallback take-profit rule (+2.5% or more)",
          confidence: 0.6,
        });
      }

      if (holding && quote.changeRate <= -2.5) {
        decisions.push({
          symbol: quote.symbol,
          side: "SELL",
          quantity: holding.quantity,
          reason: "Fallback stop-loss rule (-2.5% or less)",
          confidence: 0.7,
        });
      }

      if (!holding && quote.changeRate > 1.2) {
        decisions.push({
          symbol: quote.symbol,
          side: "BUY",
          quantity: 1,
          reason: "Fallback momentum entry rule",
          confidence: 0.4,
        });
      }
    }

    return decisions;
  }

  private async upsertHoldingBuy(symbol: string, quantity: number, price: number) {
    const holding = await this.holdingRepository.findOne({ where: { symbol } });
    if (!holding) {
      await this.holdingRepository.save({ symbol, quantity, avgPrice: price });
      return;
    }

    const totalQuantity = holding.quantity + quantity;
    const totalCost = holding.avgPrice * holding.quantity + price * quantity;
    const avgPrice = totalCost / totalQuantity;

    holding.quantity = totalQuantity;
    holding.avgPrice = avgPrice;
    await this.holdingRepository.save(holding);
  }

  private async upsertHoldingSell(symbol: string, quantity: number) {
    const holding = await this.holdingRepository.findOne({ where: { symbol } });
    if (!holding) {
      return;
    }

    const remaining = holding.quantity - quantity;
    if (remaining <= 0) {
      await this.holdingRepository.remove(holding);
      return;
    }

    holding.quantity = remaining;
    await this.holdingRepository.save(holding);
  }

  private async calculateHoldingsValue(quoteMap: Record<string, number>) {
    const holdings = await this.holdingRepository.find();
    return holdings.reduce((acc, holding) => {
      const price = quoteMap[holding.symbol] ?? holding.avgPrice;
      return acc + price * holding.quantity;
    }, 0);
  }

  private resolveExecutionPrice(symbol: string, quoteMap: Record<string, number>) {
    const realtime = this.kiwoom.getRealtimePrice(symbol);
    if (realtime?.price) {
      return realtime.price;
    }
    return quoteMap[symbol] ?? 0;
  }
}
