import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Holding, PortfolioSnapshot, PortfolioState, TradeLog } from "../entities";
import { TradeDecision } from "../types";
import { GeminiService } from "./gemini.service";
import { KiwoomService } from "./kiwoom.service";
import { StrategyService } from "./strategy.service";

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
    @Inject(StrategyService) private readonly strategyService: StrategyService,
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
    const strategy = this.strategyService.getCurrentStrategy();
    const fallback = this.ruleBasedDecisions(context.quotes, context.holdings);

    const prompt = [
      "Return JSON array only.",
      "Each item: {symbol, side(BUY|SELL|HOLD), quantity, reason, confidence}",
      "Use short-term strategy and current holdings.",
      `Strategy markdown:\n${strategy}`,
      `Holdings:${JSON.stringify(context.holdings)}`,
      `Quotes:${JSON.stringify(context.quotes)}`,
    ].join("\n\n");

    const ai = await this.gemini.generateJson<TradeDecision[]>(prompt, fallback);
    return ai.filter((item) => item.side !== "HOLD" && item.quantity > 0);
  }

  async executeDecisions(decisions: TradeDecision[], quoteMap: Record<string, number>) {
    if (decisions.length === 0) {
      await this.snapshotAsset(quoteMap);
      return;
    }

    const state = await this.ensurePortfolioState();
    const virtualMode = state.virtualMode;

    for (const decision of decisions) {
      const price = quoteMap[decision.symbol] ?? 0;
      const totalAmount = decision.quantity * price;

      if (decision.side === "BUY") {
        if (state.cash < totalAmount) {
          this.logger.warn(`Skip BUY ${decision.symbol}: insufficient cash`);
          continue;
        }

        if (!virtualMode) {
          await this.kiwoom.placeOrder({
            symbol: decision.symbol,
            side: "BUY",
            quantity: decision.quantity,
            price,
          });
        }

        state.cash -= totalAmount;
        await this.upsertHoldingBuy(decision.symbol, decision.quantity, price);
        await this.tradeLogRepository.save({
          symbol: decision.symbol,
          side: "BUY",
          quantity: decision.quantity,
          price,
          totalAmount,
          reason: decision.reason,
          mode: virtualMode ? "VIRTUAL" : "REAL",
        });
      }

      if (decision.side === "SELL") {
        const holding = await this.holdingRepository.findOne({ where: { symbol: decision.symbol } });
        if (!holding || holding.quantity < decision.quantity) {
          this.logger.warn(`Skip SELL ${decision.symbol}: insufficient holding`);
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
      }
    }

    await this.portfolioStateRepository.save(state);

    await this.snapshotAsset(quoteMap);
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
}
