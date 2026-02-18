import { Type } from "class-transformer";
import { IsDateString, IsOptional } from "class-validator";
import { PaginationDto } from "./pagination.dto";

export class TimeRangeDto extends PaginationDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
