import { IsInt, IsString, MaxLength, MinLength } from 'class-validator';

export class AdjustCreditsDto {
  @IsInt()
  amount!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason!: string;
}
