import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  elevator_pitch?: string | null;

  @IsOptional()
  @IsArray()
  value_props?: string[];

  @IsOptional()
  @IsArray()
  differentiators?: string[];

  @IsOptional()
  @IsObject()
  pricing_rules?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  dont_say?: string[];

  @IsOptional()
  @IsArray()
  faqs?: unknown[];

  @IsOptional()
  @IsArray()
  objections?: unknown[];
}
