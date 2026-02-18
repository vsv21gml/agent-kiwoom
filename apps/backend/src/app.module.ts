import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  ApiCallLog,
  GeminiCallLog,
  Holding,
  MarketQuote,
  NewsArticle,
  NewsScrapeRun,
  PortfolioSnapshot,
  PortfolioState,
  StrategyRevision,
  TradeLog,
} from "./entities";
import { HealthController } from "./monitoring/health.controller";
import { MonitoringController } from "./monitoring/monitoring.controller";
import { AgentSchedulerService } from "./services/agent-scheduler.service";
import { GeminiService } from "./services/gemini.service";
import { KiwoomService } from "./services/kiwoom.service";
import { MonitoringService } from "./services/monitoring.service";
import { NewsService } from "./services/news.service";
import { StrategyService } from "./services/strategy.service";
import { TradingService } from "./services/trading.service";

const isTrue = (value?: string) => value?.toLowerCase() === "true";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const sslEnabled = isTrue(config.get<string>("DB_SSL") ?? config.get<string>("SSL"));
        const sslIgnore = isTrue(config.get<string>("DB_SSL_IGNORE") ?? config.get<string>("SSL_IGNORE"));

        return {
          type: "postgres" as const,
          host: config.get<string>("DB_HOST") ?? "localhost",
          port: Number(config.get<string>("DB_PORT") ?? "5432"),
          username: config.get<string>("DB_USER") ?? "postgres",
          password: config.get<string>("DB_PASSWORD") ?? "",
          database: config.get<string>("DB_NAME") ?? "postgres",
          autoLoadEntities: true,
          synchronize: true,
          ssl: sslEnabled
            ? {
                rejectUnauthorized: !sslIgnore,
              }
            : false,
        };
      },
    }),
    TypeOrmModule.forFeature([
      ApiCallLog,
      GeminiCallLog,
      NewsScrapeRun,
      NewsArticle,
      TradeLog,
      Holding,
      PortfolioState,
      PortfolioSnapshot,
      StrategyRevision,
      MarketQuote,
    ]),
  ],
  controllers: [HealthController, MonitoringController],
  providers: [
    KiwoomService,
    GeminiService,
    StrategyService,
    NewsService,
    TradingService,
    AgentSchedulerService,
    MonitoringService,
  ],
})
export class AppModule {}
