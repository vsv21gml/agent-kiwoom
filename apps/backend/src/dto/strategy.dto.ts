import { IsString, MinLength } from "class-validator";

export class UpdateStrategyDto {
  @IsString()
  @MinLength(1)
  content!: string;
}
