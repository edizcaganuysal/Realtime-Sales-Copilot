import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CallMode, GuidanceLevel, LiveLayout } from '@live-sales-coach/shared';

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
  @IsString()
  practicePersonaId?: string;

  @IsOptional()
  @IsString()
  customPersonaPrompt?: string;
}
