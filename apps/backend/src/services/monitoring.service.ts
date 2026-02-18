import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ApiCallLog, GeminiCallLog, Holding, NewsArticle, PortfolioSnapshot, PortfolioState, ReportRun, TradeLog } from "../entities";
import { UniverseService } from "./universe.service";
import { ApiLogsQueryDto } from "../dto/api-logs.dto";
import { LlmLogsQueryDto } from "../dto/llm-logs.dto";
import { NewsLogsQueryDto } from "../dto/news-logs.dto";
import { ReportsQueryDto } from "../dto/reports.dto";
import { TradeLogsQueryDto } from "../dto/trade-logs.dto";

@Injectable()
export class MonitoringService {
  constructor(
    @InjectRepository(ApiCallLog) private readonly apiCallLogRepository: Repository<ApiCallLog>,
    @InjectRepository(GeminiCallLog) private readonly geminiCallLogRepository: Repository<GeminiCallLog>,
    @InjectRepository(NewsArticle) private readonly newsArticleRepository: Repository<NewsArticle>,
    @InjectRepository(TradeLog) private readonly tradeLogRepository: Repository<TradeLog>,
    @InjectRepository(PortfolioSnapshot) private readonly portfolioSnapshotRepository: Repository<PortfolioSnapshot>,
    @InjectRepository(Holding) private readonly holdingRepository: Repository<Holding>,
    @InjectRepository(PortfolioState) private readonly portfolioStateRepository: Repository<PortfolioState>,
    @InjectRepository(ReportRun) private readonly reportRunRepository: Repository<ReportRun>,
    @Inject(UniverseService) private readonly universeService: UniverseService,
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
    qb.orderBy("trade.createdAt", "DESC").skip((page - 1) * pageSize).take(pageSize);
    const [items, total] = await qb.getManyAndCount();

    const entryMap = new Map((await this.universeService.getEntries()).map((entry) => [entry.symbol, entry.name]));
    const enriched = items.map((item) => ({
      ...item,
      name: entryMap.get(item.symbol) ?? null,
    }));

    return { items: enriched, total, page, pageSize };
  }

  async getAssetTimeline(query: NewsLogsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.portfolioSnapshotRepository.createQueryBuilder("snap");
    this.applyTimeRange(qb, "snap", query.from, query.to);
    qb.orderBy("snap.createdAt", "DESC").skip((page - 1) * pageSize).take(pageSize);

    const [items, total, holdings, state] = await Promise.all([
      qb.getMany(),
      qb.getCount(),
      this.holdingRepository.find({ order: { symbol: "ASC" } }),
      this.portfolioStateRepository.findOne({ where: { id: "default" } }),
    ]);

    const entryMap = new Map((await this.universeService.getEntries()).map((entry) => [entry.symbol, entry.name]));
    const holdingsWithNames = holdings.map((holding) => ({
      ...holding,
      name: entryMap.get(holding.symbol) ?? null,
    }));

    return {
      timeline: { items, total, page, pageSize },
      summary: {
        cash: state?.cash ?? 0,
        initialCapital: state?.initialCapital ?? 0,
        virtualMode: state?.virtualMode ?? true,
        holdings: holdingsWithNames,
      },
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

  private applyTimeRange(qb: any, alias: string, from?: string, to?: string) {
    if (from) {
      qb.andWhere(`${alias}.createdAt >= :from`, { from: new Date(from).toISOString() });
    }
    if (to) {
      qb.andWhere(`${alias}.createdAt <= :to`, { to: new Date(to).toISOString() });
    }
  }
}
