import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KiwoomService } from "./kiwoom.service";
import { UniverseEntryEntity, UniverseRevision } from "../entities";

export type UniverseEntry = {
  symbol: string;
  marketCap?: number;
  name?: string;
  marketCode?: string;
  marketName?: string;
};

@Injectable()
export class UniverseService {
  private readonly logger = new Logger(UniverseService.name);
  private cache: { entries: UniverseEntry[]; loadedAt: number } | null = null;
  private readonly cacheTtlMs = 10 * 60 * 1000;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(KiwoomService) private readonly kiwoom: KiwoomService,
    @InjectRepository(UniverseEntryEntity)
    private readonly universeRepository: Repository<UniverseEntryEntity>,
    @InjectRepository(UniverseRevision)
    private readonly universeRevisionRepository: Repository<UniverseRevision>,
  ) {}

  async getEntries(): Promise<UniverseEntry[]> {
    if (this.cache && Date.now() - this.cache.loadedAt < this.cacheTtlMs) {
      return this.cache.entries;
    }

    try {
      const rows = await this.universeRepository.find({ order: { symbol: "ASC" } });
      const normalized = rows.map((row) => ({
        symbol: row.symbol,
        marketCap: row.marketCap ?? undefined,
        name: row.name ?? undefined,
        marketCode: row.marketCode ?? undefined,
        marketName: row.marketName ?? undefined,
      }));
      this.cache = { entries: normalized, loadedAt: Date.now() };
      return normalized;
    } catch (error) {
      this.logger.warn(`Failed to load universe entries: ${String(error)}`);
      this.cache = { entries: [], loadedAt: Date.now() };
      return [];
    }
  }

  async refreshFromSource() {
    const sourceUrl = this.config.get<string>("UNIVERSE_SOURCE_URL") ?? "";
    if (!sourceUrl) {
      this.logger.warn("Universe refresh skipped (UNIVERSE_SOURCE_URL not set).");
      return;
    }

    const formatOverride = (this.config.get<string>("UNIVERSE_SOURCE_FORMAT") ?? "").toLowerCase();
    const symbolField = (this.config.get<string>("UNIVERSE_SOURCE_SYMBOL_FIELD") ?? "symbol").toLowerCase();
    const marketCapField = (this.config.get<string>("UNIVERSE_SOURCE_MARKET_CAP_FIELD") ?? "marketcap").toLowerCase();
    const nameField = (this.config.get<string>("UNIVERSE_SOURCE_NAME_FIELD") ?? "name").toLowerCase();

    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) {
        this.logger.warn(`Universe refresh failed: status=${response.status}`);
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      const raw = await response.text();
      const format =
        formatOverride ||
        (sourceUrl.toLowerCase().endsWith(".json") || contentType.includes("json") ? "json" : "csv");

      const entries =
        format === "json"
          ? this.normalizeUniverseJson(raw, symbolField, marketCapField, nameField)
          : this.normalizeUniverseCsv(raw, symbolField, marketCapField, nameField);

      if (entries.length === 0) {
        this.logger.warn("Universe refresh returned no entries.");
        return;
      }

      await this.replaceUniverseEntries(entries, "source", sourceUrl);
      this.logger.log(`Universe refreshed from source: entries=${entries.length}`);
    } catch (error) {
      this.logger.warn(`Universe refresh failed: ${String(error)}`);
    }
  }

  async refreshFromKiwoom(options: { markets: string[] }) {
    const marketTypes = options.markets.length > 0 ? options.markets : ["0", "10"];
    const entries: UniverseEntry[] = [];

    for (const marketType of marketTypes) {
      const list = await this.kiwoom.getStockList(marketType);
      for (const item of list) {
        const marketCap = item.listCount * item.lastPrice;
        entries.push({
          symbol: item.symbol,
          name: item.name,
          marketCap,
          marketCode: item.marketCode ?? marketType,
          marketName: item.marketName,
        });
      }
    }

    if (entries.length === 0) {
      this.logger.warn("Universe refresh from Kiwoom returned no entries.");
      return;
    }

    await this.replaceUniverseEntries(entries, "kiwoom", `markets=${marketTypes.join(",")}`);
    this.logger.log(`Universe refreshed from Kiwoom: entries=${entries.length}`);
  }

  private normalizeUniverseJson(
    raw: string,
    symbolField: string,
    marketCapField: string,
    nameField: string,
  ): UniverseEntry[] {
    try {
      const payload = JSON.parse(raw) as Array<Record<string, unknown>>;
      return payload
        .map((row) => ({
          symbol: String(row[symbolField] ?? row.symbol ?? "").trim(),
          marketCap: Number(row[marketCapField] ?? row.marketCap ?? 0),
          name: String(row[nameField] ?? row.name ?? "").trim() || undefined,
          marketCode: String(row.marketCode ?? row.market_cd ?? "").trim() || undefined,
          marketName: String(row.marketName ?? row.market_nm ?? "").trim() || undefined,
        }))
        .filter((entry) => entry.symbol);
    } catch (error) {
      this.logger.warn(`Universe JSON parse failed: ${String(error)}`);
      return [];
    }
  }

  private normalizeUniverseCsv(
    raw: string,
    symbolField: string,
    marketCapField: string,
    nameField: string,
  ): UniverseEntry[] {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      return [];
    }

    const header = lines[0].toLowerCase();
    const headers = header.split(",").map((value) => value.trim());
    const hasHeader = headers.some((value) => value.includes("symbol") || value.includes("code") || value.includes("ticker"));
    const dataLines = hasHeader ? lines.slice(1) : lines;
    const symbolIndex = hasHeader ? headers.findIndex((h) => h === symbolField) : 0;
    const marketCapIndex = hasHeader ? headers.findIndex((h) => h === marketCapField) : 1;
    const nameIndex = hasHeader ? headers.findIndex((h) => h === nameField) : 2;
    const marketCodeIndex = hasHeader ? headers.findIndex((h) => h === "marketcode") : 3;
    const marketNameIndex = hasHeader ? headers.findIndex((h) => h === "marketname") : 4;

    return dataLines
      .map((line) => line.split(",").map((value) => value.trim()))
      .map((cols) => ({
        symbol: cols[symbolIndex] ?? "",
        marketCap: Number(cols[marketCapIndex] ?? 0),
        name: cols[nameIndex] ?? undefined,
        marketCode: cols[marketCodeIndex] ?? undefined,
        marketName: cols[marketNameIndex] ?? undefined,
      }))
      .filter((entry) => entry.symbol);
  }

  async replaceUniverseEntries(entries: UniverseEntry[], source: string, note?: string) {
    await this.universeRepository.clear();
    const rows = entries.map((entry) =>
      this.universeRepository.create({
        symbol: entry.symbol,
        name: entry.name ?? null,
        marketCap: entry.marketCap ?? null,
        marketCode: entry.marketCode ?? null,
        marketName: entry.marketName ?? null,
      }),
    );
    await this.universeRepository.save(rows);
    await this.universeRevisionRepository.save({
      source,
      note: note ?? null,
      entryCount: entries.length,
    });
    this.cache = null;
  }

  async listEntries(page = 1, pageSize = 50) {
    const [items, total] = await this.universeRepository.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { symbol: "ASC" },
    });
    return { items, total, page, pageSize };
  }

  async listRevisions(page = 1, pageSize = 20) {
    const [items, total] = await this.universeRevisionRepository.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { createdAt: "DESC" },
    });
    return { items, total, page, pageSize };
  }
}
