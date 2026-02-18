import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ApiCallLog, GeminiCallLog, Holding, NewsArticle, PortfolioSnapshot, PortfolioState, TradeLog } from "../entities";

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
  ) {}

  async getApiCallLogs(page: number, pageSize: number) {
    const [items, total] = await this.apiCallLogRepository.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { createdAt: "DESC" },
    });

    return { items, total, page, pageSize };
  }

  async getNewsLogs(page: number, pageSize: number) {
    const [items, total] = await this.newsArticleRepository.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { createdAt: "DESC" },
    });

    return { items, total, page, pageSize };
  }

  async getLlmCallLogs(page: number, pageSize: number) {
    const [items, total] = await this.geminiCallLogRepository.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { createdAt: "DESC" },
    });

    return { items, total, page, pageSize };
  }

  async getTradeLogs(page: number, pageSize: number) {
    const [items, total] = await this.tradeLogRepository.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { createdAt: "DESC" },
    });

    return { items, total, page, pageSize };
  }

  async getAssetTimeline(page: number, pageSize: number) {
    const [items, total, holdings, state] = await Promise.all([
      this.portfolioSnapshotRepository.find({
        skip: (page - 1) * pageSize,
        take: pageSize,
        order: { createdAt: "DESC" },
      }),
      this.portfolioSnapshotRepository.count(),
      this.holdingRepository.find({ order: { symbol: "ASC" } }),
      this.portfolioStateRepository.findOne({ where: { id: "default" } }),
    ]);

    return {
      timeline: { items, total, page, pageSize },
      summary: {
        cash: state?.cash ?? 0,
        initialCapital: state?.initialCapital ?? 0,
        virtualMode: state?.virtualMode ?? true,
        holdings,
      },
    };
  }
}
