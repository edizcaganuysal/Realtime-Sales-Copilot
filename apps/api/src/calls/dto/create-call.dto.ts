import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { GuidanceLevel, LiveLayout } from '@live-sales-coach/shared';

export class CreateCallDto {
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
}
