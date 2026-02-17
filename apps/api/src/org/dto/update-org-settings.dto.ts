import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional } from 'class-validator';
import { PublisherPolicy, LiveLayout, RETENTION_DAYS } from '@live-sales-coach/shared';

export class UpdateOrgSettingsDto {
  @IsOptional()
  @IsBoolean()
  requiresAgentApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  allowRepAgentCreation?: boolean;

  @IsOptional()
  @IsEnum(PublisherPolicy)
  publisherPolicy?: PublisherPolicy;

  @IsOptional()
  @IsEnum(LiveLayout)
  liveLayoutDefault?: LiveLayout;

  @IsOptional()
  @IsInt()
  @IsIn([...RETENTION_DAYS])
  retentionDays?: number;
}
