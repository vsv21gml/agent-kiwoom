import { IsIn, IsOptional, IsString } from "class-validator";
import { TimeRangeDto } from "./time-range.dto";

export class TradeLogsQueryDto extends TimeRangeDto {
  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsIn(["BUY", "SELL"])
  side?: "BUY" | "SELL";

  @IsOptional()
  @IsIn(["ORDER_REQUESTED", "EXECUTED", "PARTIALLY_FILLED", "NOT_FILLED"])
  status?: "ORDER_REQUESTED" | "EXECUTED" | "PARTIALLY_FILLED" | "NOT_FILLED";
}
