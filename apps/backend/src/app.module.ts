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
  ReportRun,
  StrategyDocument,
  StrategyRevision,
  TradeLog,
  UniverseEntryEntity,
  UniverseRevision,
} from "./entities";
import { HealthController } from "./monitoring/health.controller";
import { MonitoringController } from "./monitoring/monitoring.controller";
import { StrategyController } from "./strategy/strategy.controller";
import { UniverseController } from "./universe/universe.controller";
import { KiwoomController } from "./kiwoom/kiwoom.controller";
import { AgentSchedulerService } from "./services/agent-scheduler.service";
import { GeminiService } from "./services/gemini.service";
import { KiwoomService } from "./services/kiwoom.service";
import { KiwoomEventsService } from "./services/kiwoom-events.service";
import { MonitoringEventsService } from "./services/monitoring-events.service";
import { MonitoringService } from "./services/monitoring.service";
import { NewsService } from "./services/news.service";
import { StrategyService } from "./services/strategy.service";
import { TradingService } from "./services/trading.service";
import { UniverseService } from "./services/universe.service";

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
    ReportRun,
    StrategyDocument,
    StrategyRevision,
    MarketQuote,
    UniverseEntryEntity,
    UniverseRevision,
  ]),
  ],
  controllers: [HealthController, MonitoringController, StrategyController, UniverseController, KiwoomController],
  providers: [
    KiwoomService,
    GeminiService,
    StrategyService,
    NewsService,
    TradingService,
    AgentSchedulerService,
    MonitoringEventsService,
    KiwoomEventsService,
    UniverseService,
    MonitoringService,
  ],
})
export class AppModule {}
