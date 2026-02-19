import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class PromptDebugDto {
  @IsString()
  @MaxLength(20000)
  transcript!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  agentId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ALL', 'SELECTED'])
  products_mode?: 'ALL' | 'SELECTED';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selected_product_ids?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['MINIMAL', 'STANDARD', 'GUIDED'])
  guidance_level?: 'MINIMAL' | 'STANDARD' | 'GUIDED';

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  notes?: string;
}
