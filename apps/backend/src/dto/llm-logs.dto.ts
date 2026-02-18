import { IsIn, IsOptional, IsString } from "class-validator";
import { TimeRangeDto } from "./time-range.dto";

export class LlmLogsQueryDto extends TimeRangeDto {
  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsIn(["success", "error"])
  status?: "success" | "error";
}
