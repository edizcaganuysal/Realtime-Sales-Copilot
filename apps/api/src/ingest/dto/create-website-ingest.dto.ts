import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
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
  maxPages?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  pagesToScan?: number;

  @IsOptional()
  @IsString()
  @IsIn(['QUICK', 'STANDARD', 'DEEP'])
  focus?: 'QUICK' | 'STANDARD' | 'DEEP';

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
