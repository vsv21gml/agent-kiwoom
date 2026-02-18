import { Controller, Get, Inject, MessageEvent, Param, Post, Query, Sse } from "@nestjs/common";
import { Observable } from "rxjs";
import { ApiLogsQueryDto } from "../dto/api-logs.dto";
import { LlmLogsQueryDto } from "../dto/llm-logs.dto";
import { NewsLogsQueryDto } from "../dto/news-logs.dto";
import { ReportsQueryDto } from "../dto/reports.dto";
import { TradeLogsQueryDto } from "../dto/trade-logs.dto";
import { AgentSchedulerService } from "../services/agent-scheduler.service";
import { MonitoringEventsService } from "../services/monitoring-events.service";
import { MonitoringService } from "../services/monitoring.service";

@Controller("monitoring")
export class MonitoringController {
  constructor(
    @Inject(MonitoringService) private readonly monitoringService: MonitoringService,
    @Inject(MonitoringEventsService) private readonly monitoringEvents: MonitoringEventsService,
    @Inject(AgentSchedulerService) private readonly scheduler: AgentSchedulerService,
  ) {}

  @Get("api-calls")
  getApiCallLogs(@Query() query: ApiLogsQueryDto) {
    return this.monitoringService.getApiCallLogs(query);
  }

  @Get("news")
  getNewsLogs(@Query() query: NewsLogsQueryDto) {
    return this.monitoringService.getNewsLogs(query);
  }

  @Get("llm-calls")
  getLlmCallLogs(@Query() query: LlmLogsQueryDto) {
    return this.monitoringService.getLlmCallLogs(query);
  }

  @Get("gemini-calls")
  getGeminiCallLogsCompat(@Query() query: LlmLogsQueryDto) {
    return this.monitoringService.getLlmCallLogs(query);
  }

  @Get("trades")
  getTradeLogs(@Query() query: TradeLogsQueryDto) {
    return this.monitoringService.getTradeLogs(query);
  }

  @Get("assets")
  getAssets(@Query() query: NewsLogsQueryDto) {
    return this.monitoringService.getAssetTimeline(query);
  }

  @Get("reports")
  getReports(@Query() query: ReportsQueryDto) {
    return this.monitoringService.getReports(query);
  }

  @Get("reports/:id")
  getReport(@Param("id") id: string) {
    return this.monitoringService.getReport(id);
  }

  @Post("reports/run")
  async runReportNow() {
    const runId = await this.scheduler.runMarketCycle();
    return { runId };
  }

  @Post("news/run")
  async runNewsNow() {
    await this.scheduler.runNewsCycleNow();
    return { ok: true };
  }

  @Sse("stream")
  stream(): Observable<MessageEvent> {
    return this.monitoringEvents.stream();
  }
}
