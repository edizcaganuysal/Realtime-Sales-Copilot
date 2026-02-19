import { IsArray, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class QualityProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  elevator_pitch?: string;

  @IsOptional()
  @IsArray()
  value_props?: unknown[];

  @IsOptional()
  @IsArray()
  differentiators?: unknown[];

  @IsOptional()
  @IsObject()
  pricing_rules?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  dont_say?: unknown[];

  @IsOptional()
  @IsArray()
  faqs?: unknown[];

  @IsOptional()
  @IsArray()
  objections?: unknown[];
}
