import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFineTuneRequestDto {
  @IsOptional()
  @IsArray()
  data_sources?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  compliance_notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  notes?: string;
}
