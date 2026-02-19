import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateCreditRequestDto {
  @IsString()
  @MaxLength(80)
  package!: string;

  @IsInt()
  @Min(1)
  credits!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
