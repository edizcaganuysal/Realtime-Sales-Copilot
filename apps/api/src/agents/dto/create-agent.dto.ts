import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AgentScope } from '@live-sales-coach/shared';

export class CreateAgentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(1)
  prompt!: string;

  @IsOptional()
  @IsEnum(AgentScope)
  scope?: AgentScope;

  @IsOptional()
  @IsObject()
  configJson?: Record<string, unknown>;
}
