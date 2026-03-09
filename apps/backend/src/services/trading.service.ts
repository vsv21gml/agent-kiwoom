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

    return this.portfolioStateRepository.save({
      id: "default",
      initialCapital,
      cash: initialCapital,
    });
  }

  async decideTrades(context: {
    quotes: Array<{ symbol: string; price: number; changeRate: number; volume: number }>;
    holdings: Holding[];
  }): Promise<TradeDecision[]> {
    const strategy = await this.strategyService.getCurrentStrategy();
    const state = await this.ensurePortfolioState();
    const policy = await this.strategyService.getTradingPolicy();
    const disableFallback = (this.config.get<string>("DISABLE_FALLBACK_RULES") ?? "true") === "true";
    const fallback = disableFallback ? [] : this.ruleBasedDecisions(context.quotes, context.holdings);
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
      status: "EXECUTED" | "ORDER_REQUESTED" | "PARTIALLY_FILLED" | "NOT_FILLED";
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

    const state = await this.ensurePortfolioState();
    const policy = await this.strategyService.getTradingPolicy();
    const isVirtualMode = (this.config.get<string>("VIRTUAL_TRADING_MODE") ?? "true").toLowerCase() === "true";
    if (decisions.length === 0) {
      if (isVirtualMode) {
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
      const account = await this.kiwoom.getAccountEvaluation({});
      await this.syncPortfolioFromAccount(account);
      await this.portfolioSnapshotRepository.save({
        cash: account.cash,
        holdingsValue: account.holdingsValue,
        totalAsset: account.totalAsset,
      });
      return {
        executed,
        skipped,
        cash: account.cash,
        holdingsValue: account.holdingsValue,
        totalAsset: account.totalAsset,
      };
    }

    let holdingsValueForSizing = 0;
    let totalAssetForSizing = 0;
    let holdingsForExecution: Array<{ symbol: string; quantity: number; avgPrice: number }> = [];
    let availableCash = state.cash;
    const apiOrderRequests: Array<{ id: string; symbol: string; side: "BUY" | "SELL"; quantity: number }> = [];

    if (isVirtualMode) {
      const localHoldings = await this.holdingRepository.find();
      holdingsForExecution = localHoldings.map((holding) => ({
        symbol: holding.symbol,
        quantity: holding.quantity,
        avgPrice: holding.avgPrice,
      }));
      holdingsValueForSizing = localHoldings.reduce((acc, holding) => {
        const price = quoteMap[holding.symbol] ?? holding.avgPrice;
        return acc + price * holding.quantity;
      }, 0);
      totalAssetForSizing = state.cash + holdingsValueForSizing;
      availableCash = state.cash;
    } else {
      const account = await this.kiwoom.getAccountEvaluation({});
      state.cash = account.cash;
      await this.portfolioStateRepository.save(state);
      holdingsForExecution = (account.holdings ?? []).map((holding) => ({
        symbol: holding.symbol,
        quantity: holding.quantity,
        avgPrice: holding.avgPrice,
      }));
      holdingsValueForSizing = account.holdingsValue;
      totalAssetForSizing = account.totalAsset;
      availableCash = account.cash;
    }

    const lossStreak = await this.getTodayConsecutiveLosses();
    if (lossStreak >= 2) {
      this.logger.warn(`Trading halted: ${lossStreak} consecutive losses today.`);
      for (const decision of decisions) {
        if (decision.side === "HOLD") {
          continue;
        }
        skipped.push({
          symbol: decision.symbol,
          side: decision.side,
          quantity: decision.quantity,
          price: this.resolveExecutionPrice(decision.symbol, quoteMap),
          totalAmount: this.resolveExecutionPrice(decision.symbol, quoteMap) * decision.quantity,
          reason: "Stopped after consecutive losses (policy)",
          status: "SKIPPED_POLICY",
        });
      }
      if (isVirtualMode) {
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
      const account = await this.kiwoom.getAccountEvaluation({});
      await this.syncPortfolioFromAccount(account);
      await this.portfolioSnapshotRepository.save({
        cash: account.cash,
        holdingsValue: account.holdingsValue,
        totalAsset: account.totalAsset,
      });
      return {
        executed,
        skipped,
        cash: account.cash,
        holdingsValue: account.holdingsValue,
        totalAsset: account.totalAsset,
      };
    }

    const maxPositionValue =
      policy.positionSizePct > 0 ? (totalAssetForSizing * policy.positionSizePct) / 100 : 0;
    const processedSymbols = new Set<string>();
    const accountHoldingMap = new Map(
      holdingsForExecution.map((holding) => [holding.symbol, holding]),
    );
    const maxPositions = 2;
    let openPositions = holdingsForExecution.filter((holding) => holding.quantity > 0).length;
    let pendingNewPositions = 0;

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
        if (openPositions + pendingNewPositions >= maxPositions) {
          this.logger.warn(`Skip BUY ${decision.symbol}: max positions ${maxPositions} reached`);
          skipped.push({
            symbol: decision.symbol,
            side: "BUY",
            quantity: decision.quantity,
            price,
            totalAmount,
            reason: `${decision.reason ?? ""} (max positions ${maxPositions})`.trim(),
            status: "SKIPPED_POLICY",
          });
          continue;
        }
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

        const maxAffordable = Math.floor(availableCash / price);
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
        const adjustedReason =
          finalQuantity < decision.quantity
            ? `${decision.reason ?? ""} (auto-resized from ${decision.quantity} to ${finalQuantity})`.trim()
            : decision.reason;
        if (finalQuantity < decision.quantity) {
          this.logger.warn(
            `Reduce BUY ${decision.symbol}: requested=${decision.quantity}, affordable=${finalQuantity}`,
          );
        }

        if (!isVirtualMode) {
          const accountQtyBefore = accountHoldingMap.get(decision.symbol)?.quantity ?? 0;
          await this.kiwoom.placeOrder({
            symbol: decision.symbol,
            side: "BUY",
            quantity: finalQuantity,
            price,
          });
          availableCash -= finalTotal;
          const orderLog = await this.tradeLogRepository.save({
            symbol: decision.symbol,
            side: "BUY",
            quantity: finalQuantity,
            price,
            totalAmount: finalTotal,
            reason: adjustedReason,
            mode: "API",
            status: "ORDER_REQUESTED",
            accountQtyBefore,
          });
          apiOrderRequests.push({
            id: orderLog.id,
            symbol: decision.symbol,
            side: "BUY",
            quantity: finalQuantity,
          });
          pendingNewPositions += 1;
          executed.push({
            symbol: decision.symbol,
            side: "BUY",
            quantity: finalQuantity,
            price,
            totalAmount: finalTotal,
            reason: adjustedReason,
            status: "ORDER_REQUESTED",
          });
          continue;
        }

        state.cash -= finalTotal;
        await this.upsertHoldingBuy(decision.symbol, finalQuantity, price);
        await this.tradeLogRepository.save({
          symbol: decision.symbol,
          side: "BUY",
          quantity: finalQuantity,
          price,
          totalAmount: finalTotal,
          reason: adjustedReason,
          mode: "VIRTUAL",
          status: "EXECUTED",
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
        const holding = accountHoldingMap.get(decision.symbol);
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
        const pnl = (price - holding.avgPrice) * decision.quantity;

        if (!isVirtualMode) {
          const accountQtyBefore = accountHoldingMap.get(decision.symbol)?.quantity ?? 0;
          await this.kiwoom.placeOrder({
            symbol: decision.symbol,
            side: "SELL",
            quantity: decision.quantity,
            price,
          });
          const orderLog = await this.tradeLogRepository.save({
            symbol: decision.symbol,
            side: "SELL",
            quantity: decision.quantity,
            price,
            totalAmount,
            reason: decision.reason,
            mode: "API",
            status: "ORDER_REQUESTED",
            accountQtyBefore,
            realizedPnl: pnl,
          });
          apiOrderRequests.push({
            id: orderLog.id,
            symbol: decision.symbol,
            side: "SELL",
            quantity: decision.quantity,
          });
          executed.push({
            symbol: decision.symbol,
            side: "SELL",
            quantity: decision.quantity,
            price,
            totalAmount,
            reason: decision.reason,
            status: "ORDER_REQUESTED",
          });
          continue;
        }

        state.cash += totalAmount;
        await this.upsertHoldingSell(decision.symbol, decision.quantity);
        await this.tradeLogRepository.save({
          symbol: decision.symbol,
          side: "SELL",
          quantity: decision.quantity,
          price,
          totalAmount,
          reason: decision.reason,
          mode: "VIRTUAL",
          status: "EXECUTED",
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

    if (isVirtualMode) {
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

    const refreshedAccount = await this.kiwoom.getAccountEvaluation({});
    const statusByLogId = this.reconcileApiOrderStatuses(
      apiOrderRequests,
      holdingsForExecution,
      refreshedAccount.holdings ?? [],
    );
    for (const [id, status] of statusByLogId.entries()) {
      await this.tradeLogRepository.update({ id }, { status });
    }
    for (const item of executed) {
      if (item.status !== "ORDER_REQUESTED") {
        continue;
      }
      const log = apiOrderRequests.find(
        (request) =>
          request.symbol === item.symbol &&
          request.side === item.side &&
          request.quantity === item.quantity,
      );
      const finalStatus = log ? statusByLogId.get(log.id) : undefined;
      if (finalStatus) {
        item.status = finalStatus;
      }
    }
    await this.syncPortfolioFromAccount(refreshedAccount);
    await this.portfolioSnapshotRepository.save({
      cash: refreshedAccount.cash,
      holdingsValue: refreshedAccount.holdingsValue,
      totalAsset: refreshedAccount.totalAsset,
    });
    return {
      executed,
      skipped,
      cash: refreshedAccount.cash,
      holdingsValue: refreshedAccount.holdingsValue,
      totalAsset: refreshedAccount.totalAsset,
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

  private reconcileApiOrderStatuses(
    requests: Array<{ id: string; symbol: string; side: "BUY" | "SELL"; quantity: number }>,
    beforeHoldings: Array<{ symbol: string; quantity: number }>,
    afterHoldings: Array<{ symbol: string; quantity: number }>,
  ) {
    const beforeQty = new Map(beforeHoldings.map((holding) => [holding.symbol, holding.quantity]));
    const afterQty = new Map(afterHoldings.map((holding) => [holding.symbol, holding.quantity]));

    const buyFilledBySymbol = new Map<string, number>();
    const sellFilledBySymbol = new Map<string, number>();
    const symbols = new Set<string>([
      ...beforeQty.keys(),
      ...afterQty.keys(),
      ...requests.map((request) => request.symbol),
    ]);
    for (const symbol of symbols) {
      const before = beforeQty.get(symbol) ?? 0;
      const after = afterQty.get(symbol) ?? 0;
      buyFilledBySymbol.set(symbol, Math.max(0, after - before));
      sellFilledBySymbol.set(symbol, Math.max(0, before - after));
    }

    const result = new Map<string, "EXECUTED" | "PARTIALLY_FILLED" | "NOT_FILLED">();
    for (const request of requests) {
      if (request.side === "BUY") {
        const remaining = buyFilledBySymbol.get(request.symbol) ?? 0;
        if (remaining >= request.quantity) {
          result.set(request.id, "EXECUTED");
          buyFilledBySymbol.set(request.symbol, remaining - request.quantity);
        } else if (remaining > 0) {
          result.set(request.id, "PARTIALLY_FILLED");
          buyFilledBySymbol.set(request.symbol, 0);
        } else {
          result.set(request.id, "NOT_FILLED");
        }
        continue;
      }

      const remaining = sellFilledBySymbol.get(request.symbol) ?? 0;
      if (remaining >= request.quantity) {
        result.set(request.id, "EXECUTED");
        sellFilledBySymbol.set(request.symbol, remaining - request.quantity);
      } else if (remaining > 0) {
        result.set(request.id, "PARTIALLY_FILLED");
        sellFilledBySymbol.set(request.symbol, 0);
      } else {
        result.set(request.id, "NOT_FILLED");
      }
    }

    return result;
  }

  private getTodayConsecutiveLosses = async () => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const logs = await this.tradeLogRepository.find({
      where: {
        side: "SELL",
        status: "EXECUTED",
      },
      order: { createdAt: "ASC" },
      take: 500,
    });
    const todayLogs = logs.filter(
      (log) =>
        log.realizedPnl != null &&
        new Date(log.createdAt).getTime() >= start.getTime() &&
        new Date(log.createdAt).getTime() <= now.getTime(),
    );
    let streak = 0;
    for (const log of todayLogs) {
      if ((log.realizedPnl ?? 0) < 0) {
        streak += 1;
      } else {
        streak = 0;
      }
    }
    return streak;
  };

  private async syncPortfolioFromAccount(account: Awaited<ReturnType<KiwoomService["getAccountEvaluation"]>>) {
    const state = await this.ensurePortfolioState();
    state.cash = account.cash;
    await this.portfolioStateRepository.save(state);

    await this.holdingRepository.clear();
    const next = (account.holdings ?? [])
      .filter((holding) => holding.symbol && holding.quantity > 0)
      .map((holding) => ({
        symbol: holding.symbol,
        quantity: holding.quantity,
        avgPrice: holding.avgPrice,
      }));
    if (next.length > 0) {
      await this.holdingRepository.save(next);
    }
  }
}
