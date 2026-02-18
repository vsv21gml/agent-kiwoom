import { IsIn, IsOptional, IsString } from "class-validator";
import { TimeRangeDto } from "./time-range.dto";

export class ApiLogsQueryDto extends TimeRangeDto {
  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsIn(["success", "error"])
  status?: "success" | "error";
}
