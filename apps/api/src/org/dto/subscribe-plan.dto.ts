import { IsString, MinLength, MaxLength } from 'class-validator';

export class SubscribePlanDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  plan_id!: string;
}
