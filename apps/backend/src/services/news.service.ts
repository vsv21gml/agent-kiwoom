import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import Parser from "rss-parser";
import { Repository } from "typeorm";
import { NewsArticle, NewsScrapeRun } from "../entities";
import { GeminiService } from "./gemini.service";
import { StrategyService } from "./strategy.service";

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);
  private readonly parser = new Parser();

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @InjectRepository(NewsScrapeRun)
    private readonly newsScrapeRunRepository: Repository<NewsScrapeRun>,
    @InjectRepository(NewsArticle)
    private readonly newsArticleRepository: Repository<NewsArticle>,
    @Inject(GeminiService) private readonly gemini: GeminiService,
    @Inject(StrategyService) private readonly strategyService: StrategyService,
  ) {}

  async scrapeLatestNews() {
    const feeds = (this.config.get<string>("NEWS_FEEDS") ?? "")
      .split(",")
      .map((feed) => feed.trim())
      .filter(Boolean);

    const articles: Array<{
      title: string;
      url: string;
      source: string;
      publishedAt?: Date;
      summary?: string;
    }> = [];

    for (const feed of feeds) {
      try {
        const parsed = await this.parser.parseURL(feed);
        const topItems = (parsed.items ?? []).slice(0, 10);

        for (const item of topItems) {
          if (!item.link || !item.title) {
            continue;
          }
          articles.push({
            title: item.title,
            url: item.link,
            source: parsed.title ?? feed,
            publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
            summary: item.contentSnippet ?? item.content ?? undefined,
          });
        }

        try {
          await this.newsScrapeRunRepository.save({
            source: parsed.title ?? feed,
            query: "stock market",
            itemCount: topItems.length,
          });
        } catch (error) {
          this.logger.warn(`Failed to record scrape run for ${feed}: ${String(error)}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to scrape feed ${feed}: ${String(error)}`);
      }
    }

    for (const article of articles) {
      try {
        const existing = await this.newsArticleRepository.findOne({ where: { url: article.url } });
        await this.newsArticleRepository.save({
          ...(existing ?? {}),
          title: article.title,
          url: article.url,
          source: article.source,
          publishedAt: article.publishedAt,
          summary: article.summary,
        });
      } catch (error) {
        this.logger.warn(`Failed to persist article ${article.url}: ${String(error)}`);
      }
    }

    return articles;
  }

  async refineStrategyWithNews() {
    let latestNews: Array<{
      title: string | null | undefined;
      summary: string | null | undefined;
      source: string | null | undefined;
    }>;
    try {
      const rows = await this.newsArticleRepository.find({
        take: 20,
        order: { createdAt: "DESC" },
        select: { title: true, summary: true, source: true },
      });
      latestNews = rows.map((row) => ({
        title: row.title,
        summary: row.summary,
        source: row.source,
      }));
    } catch (error) {
      this.logger.warn(`Failed to load latest news: ${String(error)}`);
      return;
    }
    if (latestNews.length === 0) {
      return;
    }

    const minIntervalHoursRaw = this.config.get<string>("NEWS_STRATEGY_MIN_INTERVAL_HOURS");
    const minIntervalHours = Number.isFinite(Number(minIntervalHoursRaw))
      ? Number(minIntervalHoursRaw)
      : 72;
    const importanceThresholdRaw = this.config.get<string>("NEWS_STRATEGY_IMPORTANCE_THRESHOLD");
    const importanceThreshold = Number.isFinite(Number(importanceThresholdRaw))
      ? Number(importanceThresholdRaw)
      : 0.9;
    const emergencyThresholdRaw = this.config.get<string>("NEWS_STRATEGY_EMERGENCY_THRESHOLD");
    const emergencyThreshold = Number.isFinite(Number(emergencyThresholdRaw))
      ? Number(emergencyThresholdRaw)
      : 0.97;

    const lastNewsRevision = await this.strategyService.getLatestRevisionBySource("news-refinement");
    const current = await this.strategyService.getCurrentStrategy();
    const prompt = [
      "You are an equity trading strategy gatekeeper.",
      "Only update the strategy for very significant, rare events (major policy shocks, systemic crises, or clear regime changes).",
      "If the news is routine or incremental, do NOT update.",
      "Return JSON only with fields: shouldUpdate (boolean), importance (0-1), reason (string), updatedStrategy (string).",
      "If shouldUpdate=false, updatedStrategy must be an empty string.",
      "Current strategy:",
      current,
      "Latest news:",
      JSON.stringify(latestNews),
    ].join("\n\n");

    const proModel = this.config.get<string>("GEMINI_PRO_MODEL") ?? "gemini-1.5-pro";
    const responseText = await this.gemini.generateTextWithModel(prompt, proModel);
    const decision = this.parseStrategyDecision(responseText);
    if (!decision) {
      this.logger.warn("News strategy update skipped: failed to parse decision JSON.");
      return;
    }

    const shouldUpdate = decision.shouldUpdate === true;
    const importance =
      typeof decision.importance === "number" && Number.isFinite(decision.importance)
        ? decision.importance
        : 0;

    const cooldownActive =
      lastNewsRevision && minIntervalHours > 0
        ? Date.now() - new Date(lastNewsRevision.createdAt).getTime() <
          minIntervalHours * 60 * 60 * 1000
        : false;

    if (!shouldUpdate) {
      this.logger.log(`News strategy update skipped: ${decision.reason ?? "no update needed"}.`);
      return;
    }

    if (importance < importanceThreshold) {
      this.logger.log(
        `News strategy update skipped: importance ${importance.toFixed(2)} below threshold ${importanceThreshold}.`,
      );
      return;
    }

    if (cooldownActive && importance < emergencyThreshold) {
      this.logger.log(
        `News strategy update skipped: cooldown active and importance ${importance.toFixed(2)} below emergency threshold ${emergencyThreshold}.`,
      );
      return;
    }

    const updatedStrategy = (decision.updatedStrategy ?? "").trim();
    if (!updatedStrategy || updatedStrategy === current.trim()) {
      this.logger.log("News strategy update skipped: no material changes.");
      return;
    }

    await this.strategyService.updateStrategy(updatedStrategy, "news-refinement");
  }

  private parseStrategyDecision(text: string): {
    shouldUpdate?: boolean;
    importance?: number;
    reason?: string;
    updatedStrategy?: string;
  } | null {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    try {
      const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      return {
        shouldUpdate: raw.shouldUpdate as boolean | undefined,
        importance: typeof raw.importance === "number" ? raw.importance : Number(raw.importance),
        reason: typeof raw.reason === "string" ? raw.reason : undefined,
        updatedStrategy: typeof raw.updatedStrategy === "string" ? raw.updatedStrategy : undefined,
      };
    } catch {
      return null;
    }
  }

  async getLatestNews(limit = 20) {
    return this.newsArticleRepository.find({
      take: limit,
      order: { createdAt: "DESC" },
      select: { title: true, summary: true, source: true, publishedAt: true },
    });
  }
}
