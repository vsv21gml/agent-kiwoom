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

        await this.newsScrapeRunRepository.save({
          source: parsed.title ?? feed,
          query: "stock market",
          itemCount: topItems.length,
        });
      } catch (error) {
        this.logger.warn(`Failed to scrape feed ${feed}: ${String(error)}`);
      }
    }

    for (const article of articles) {
      const existing = await this.newsArticleRepository.findOne({ where: { url: article.url } });
      await this.newsArticleRepository.save({
        ...(existing ?? {}),
        title: article.title,
        url: article.url,
        source: article.source,
        publishedAt: article.publishedAt,
        summary: article.summary,
      });
    }

    return articles;
  }

  async refineStrategyWithNews() {
    const latestNews = await this.newsArticleRepository.find({
      take: 20,
      order: { createdAt: "DESC" },
      select: { title: true, summary: true, source: true },
    });
    if (latestNews.length === 0) {
      return;
    }

    const current = this.strategyService.getCurrentStrategy();
    const prompt = [
      "You are an equity trading strategy updater.",
      "Update the strategy markdown for short-term trading using latest news.",
      "Keep it practical and risk-aware.",
      "Return markdown only.",
      "Current strategy:",
      current,
      "Latest news:",
      JSON.stringify(latestNews),
    ].join("\n\n");

    const updated = await this.gemini.generateText(prompt);
    if (updated.trim().length > 0) {
      await this.strategyService.updateStrategy(updated.trim(), "news-refinement");
    }
  }
}
