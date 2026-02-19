import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateWebsiteIngestDto {
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  url!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  maxPages?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  depth?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  includePaths?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  excludePaths?: string[];
}
