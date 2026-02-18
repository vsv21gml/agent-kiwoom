import { Body, Controller, Get, Inject, Param, Put, Query } from "@nestjs/common";
import { PaginationDto } from "../dto/pagination.dto";
import { UpdateStrategyDto } from "../dto/strategy.dto";
import { StrategyService } from "../services/strategy.service";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { StrategyRevision } from "../entities";

@Controller("strategy")
export class StrategyController {
  constructor(
    @Inject(StrategyService) private readonly strategyService: StrategyService,
    @InjectRepository(StrategyRevision)
    private readonly strategyRevisionRepository: Repository<StrategyRevision>,
  ) {}

  @Get()
  async getStrategy() {
    const content = await this.strategyService.getCurrentStrategy();
    return { content };
  }

  @Put()
  async updateStrategy(@Body() body: UpdateStrategyDto) {
    await this.strategyService.updateStrategy(body.content, "manual-ui");
    return { ok: true };
  }

  @Get("revisions")
  async listRevisions(@Query() query: PaginationDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.strategyRevisionRepository.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { createdAt: "DESC" },
    });
    return { items, total, page, pageSize };
  }

  @Get("revisions/:id")
  async getRevision(@Param("id") id: string) {
    return this.strategyRevisionRepository.findOne({ where: { id } });
  }
}
