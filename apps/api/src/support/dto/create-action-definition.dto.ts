import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateActionDefinitionDto {
  @IsUUID()
  integrationId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @IsArray()
  triggerPhrases?: string[];

  @IsObject()
  inputSchema!: Record<string, unknown>;

  @IsObject()
  executionConfig!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsString()
  riskLevel?: string;
}

export class UpdateActionDefinitionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  triggerPhrases?: string[];

  @IsOptional()
  @IsObject()
  inputSchema?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  executionConfig?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsString()
  riskLevel?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
