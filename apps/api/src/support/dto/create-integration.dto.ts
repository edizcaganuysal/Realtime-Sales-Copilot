import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateIntegrationDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsObject()
  configJson?: Record<string, unknown>;
}

export class UpdateIntegrationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsObject()
  configJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  status?: string;
}
