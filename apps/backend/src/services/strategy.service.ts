import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { StrategyDocument, StrategyRevision } from "../entities";

@Injectable()
export class StrategyService {
  constructor(
    @InjectRepository(StrategyRevision)
    private readonly strategyRevisionRepository: Repository<StrategyRevision>,
    @InjectRepository(StrategyDocument)
    private readonly strategyDocumentRepository: Repository<StrategyDocument>,
  ) {
    void this.ensureStrategyRecord();
  }

  async getCurrentStrategy() {
    const record = await this.ensureStrategyRecord();
    return record.content;
  }

  async getUniversePolicy() {
    const content = await this.getCurrentStrategy();
    const defaults = {
      topMarketCap: 200,
      topLiquidity: 200,
      topNews: 50,
      maxUniverse: 400,
      liquidityCandidates: 300,
      liquidityDays: 20,
      markets: ["KOSPI", "KOSDAQ"],
      includeManaged: false,
      stex: "1",
    };

    const sectionMatch = content.split(/#+\s*Universe Selection/i)[1];
    if (!sectionMatch) {
      return defaults;
    }

    const section = sectionMatch.split(/\n#+\s+/)[0];
    const lines = section.split(/\r?\n/).map((line) => line.trim());
    const parsed: Record<string, string> = {};

    for (const line of lines) {
      if (!line || line.startsWith("#") || !line.includes("=")) {
        continue;
      }
      const [rawKey, ...rest] = line.split("=");
      const key = rawKey.trim().toUpperCase();
      const value = rest.join("=").trim();
      parsed[key] = value;
    }

    const parseNumber = (value: string | undefined, fallback: number) => {
      const parsedValue = Number(value);
      return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
    };

    const parseBool = (value: string | undefined, fallback: boolean) => {
      if (value === undefined) return fallback;
      return ["true", "1", "yes", "y"].includes(value.toLowerCase());
    };

    const parseMarkets = (value: string | undefined, fallback: string[]) => {
      if (!value) return fallback;
      return value
        .split(",")
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean);
    };

    return {
      topMarketCap: parseNumber(parsed.TOP_MARKET_CAP, defaults.topMarketCap),
      topLiquidity: parseNumber(parsed.TOP_LIQUIDITY, defaults.topLiquidity),
      topNews: parseNumber(parsed.TOP_NEWS, defaults.topNews),
      maxUniverse: parseNumber(parsed.MAX_UNIVERSE, defaults.maxUniverse),
      liquidityCandidates: parseNumber(parsed.LIQUIDITY_CANDIDATES, defaults.liquidityCandidates),
      liquidityDays: parseNumber(parsed.LIQUIDITY_DAYS, defaults.liquidityDays),
      markets: parseMarkets(parsed.MARKETS, defaults.markets),
      includeManaged: parseBool(parsed.INCLUDE_MANAGED, defaults.includeManaged),
      stex: parsed.STEX?.trim() || defaults.stex,
    };
  }

  async updateStrategy(content: string, source: string) {
    const record = await this.ensureStrategyRecord();
    record.content = content;
    await this.strategyDocumentRepository.save(record);
    await this.strategyRevisionRepository.save({ source, content });
  }

  private async ensureStrategyRecord() {
    const existing = await this.strategyDocumentRepository.findOne({ where: { key: "default" } });
    if (existing) {
      if (!/Universe Selection/i.test(existing.content)) {
        existing.content = `${existing.content.trim()}\n\n${this.universeSelectionTemplate()}\n`;
        return this.strategyDocumentRepository.save(existing);
      }
      return existing;
    }

    const created = this.strategyDocumentRepository.create({
      key: "default",
      content: this.defaultStrategyTemplate(),
    });
    return this.strategyDocumentRepository.save(created);
  }

  private defaultStrategyTemplate() {
    return [
      "# Short-Term Trading Strategy",
      "",
      "- Keep risk low and react fast.",
      "",
      this.universeSelectionTemplate(),
      "",
    ].join("\n");
  }

  private universeSelectionTemplate() {
    return [
      "## Universe Selection",
      "TOP_MARKET_CAP=200",
      "TOP_LIQUIDITY=200",
      "TOP_NEWS=50",
      "MAX_UNIVERSE=400",
      "LIQUIDITY_CANDIDATES=300",
      "LIQUIDITY_DAYS=20",
      "MARKETS=KOSPI,KOSDAQ",
      "INCLUDE_MANAGED=false",
      "STEX=1",
    ].join("\n");
  }
}
