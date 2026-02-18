import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateStageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  goals?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  checklistJson?: string[];
}
