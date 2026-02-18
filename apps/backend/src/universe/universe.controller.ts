import { Body, Controller, Get, Inject, Put, Query } from "@nestjs/common";
import { PaginationDto } from "../dto/pagination.dto";
import { UniverseService } from "../services/universe.service";

type UniverseEntryInput = {
  symbol: string;
  name?: string | null;
  marketCap?: number | null;
  marketCode?: string | null;
  marketName?: string | null;
};

@Controller("universe")
export class UniverseController {
  constructor(@Inject(UniverseService) private readonly universeService: UniverseService) {}

  @Get()
  list(@Query() query: PaginationDto) {
    return this.universeService.listEntries(query.page ?? 1, query.pageSize ?? 50);
  }

  @Get("revisions")
  listRevisions(@Query() query: PaginationDto) {
    return this.universeService.listRevisions(query.page ?? 1, query.pageSize ?? 20);
  }

  @Put()
  async replace(@Body() body: { entries: UniverseEntryInput[] }) {
    const entries = (body.entries ?? []).map((entry) => ({
      symbol: entry.symbol,
      name: entry.name ?? undefined,
      marketCap: entry.marketCap ?? undefined,
      marketCode: entry.marketCode ?? undefined,
      marketName: entry.marketName ?? undefined,
    }));
    await this.universeService.replaceUniverseEntries(entries, "manual", "manual update");
    return { ok: true, count: entries.length };
  }
}
