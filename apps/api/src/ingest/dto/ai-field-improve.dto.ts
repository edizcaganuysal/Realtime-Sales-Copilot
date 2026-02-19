import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class AiFieldImproveDto {
  @IsString()
  @IsIn(['company', 'product'])
  target!: 'company' | 'product';

  @IsString()
  @MaxLength(160)
  fieldKey!: string;

  @IsString()
  @MaxLength(12000)
  text!: string;

  @IsOptional()
  @IsObject()
  currentState?: Record<string, unknown>;
}
