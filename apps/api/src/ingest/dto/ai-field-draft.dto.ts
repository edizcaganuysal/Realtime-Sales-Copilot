import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class AiFieldDraftDto {
  @IsString()
  @IsIn(['company', 'product'])
  target!: 'company' | 'product';

  @IsString()
  @MaxLength(160)
  fieldKey!: string;

  @IsOptional()
  @IsObject()
  currentState?: Record<string, unknown>;
}
