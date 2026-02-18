import { IsOptional, IsString } from 'class-validator';

export class UpdateCallDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
