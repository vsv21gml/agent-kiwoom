import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Repository } from "typeorm";
import { StrategyRevision } from "../entities";

@Injectable()
export class StrategyService {
  private readonly strategyPath: string;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @InjectRepository(StrategyRevision)
    private readonly strategyRevisionRepository: Repository<StrategyRevision>,
  ) {
    this.strategyPath = join(
      process.cwd(),
      this.config.get<string>("STRATEGY_FILE_PATH") ?? "data/INVESTMENT_STRATEGY.md",
    );
    this.ensureStrategyFile();
  }

  getCurrentStrategy() {
    this.ensureStrategyFile();
    return readFileSync(this.strategyPath, "utf-8");
  }

  async updateStrategy(content: string, source: string) {
    writeFileSync(this.strategyPath, content, "utf-8");
    await this.strategyRevisionRepository.save({ source, content });
  }

  private ensureStrategyFile() {
    if (!existsSync(dirname(this.strategyPath))) {
      mkdirSync(dirname(this.strategyPath), { recursive: true });
    }

    if (!existsSync(this.strategyPath)) {
      writeFileSync(
        this.strategyPath,
        "# Short-Term Trading Strategy\n\n- Keep risk low and react fast.\n",
        "utf-8",
      );
    }
  }
}
