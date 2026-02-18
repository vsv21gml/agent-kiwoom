import { Controller, Get, Inject, Query } from "@nestjs/common";
import { PaginationDto } from "../dto/pagination.dto";
import { MonitoringService } from "../services/monitoring.service";

@Controller("monitoring")
export class MonitoringController {
  constructor(@Inject(MonitoringService) private readonly monitoringService: MonitoringService) {}

  @Get("api-calls")
  getApiCallLogs(@Query() query: PaginationDto) {
    return this.monitoringService.getApiCallLogs(query.page ?? 1, query.pageSize ?? 20);
  }

  @Get("news")
  getNewsLogs(@Query() query: PaginationDto) {
    return this.monitoringService.getNewsLogs(query.page ?? 1, query.pageSize ?? 20);
  }

  @Get("llm-calls")
  getLlmCallLogs(@Query() query: PaginationDto) {
    return this.monitoringService.getLlmCallLogs(query.page ?? 1, query.pageSize ?? 20);
  }

  @Get("gemini-calls")
  getGeminiCallLogsCompat(@Query() query: PaginationDto) {
    return this.monitoringService.getLlmCallLogs(query.page ?? 1, query.pageSize ?? 20);
  }

  @Get("trades")
  getTradeLogs(@Query() query: PaginationDto) {
    return this.monitoringService.getTradeLogs(query.page ?? 1, query.pageSize ?? 20);
  }

  @Get("assets")
  getAssets(@Query() query: PaginationDto) {
    return this.monitoringService.getAssetTimeline(query.page ?? 1, query.pageSize ?? 20);
  }
}
