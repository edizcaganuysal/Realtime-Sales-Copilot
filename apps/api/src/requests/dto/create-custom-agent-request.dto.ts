import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCustomAgentRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  use_case?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
