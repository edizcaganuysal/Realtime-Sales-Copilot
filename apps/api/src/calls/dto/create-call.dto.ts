import { IsArray, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CallMode, GuidanceLevel, LiveLayout, ProductsMode } from '@live-sales-coach/shared';

export class CreateCallDto {
  @IsOptional()
  @IsEnum(CallMode)
  mode?: CallMode;

  @IsString()
  @MaxLength(30)
  phoneTo!: string;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsString()
  playbookId?: string;

  @IsOptional()
  @IsEnum(GuidanceLevel)
  guidanceLevel?: GuidanceLevel;

  @IsOptional()
  @IsEnum(LiveLayout)
  layoutPreset?: LiveLayout;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(['cold_outbound', 'follow_up', 'discovery'])
  call_type?: string;

  @IsOptional()
  @IsString()
  practicePersonaId?: string;

  @IsOptional()
  @IsString()
  customPersonaPrompt?: string;

  @IsOptional()
  @IsIn([ProductsMode.ALL, ProductsMode.SELECTED])
  products_mode?: ProductsMode;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  selected_product_ids?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customOpener?: string;
}
