import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSalesRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  type?: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsString()
  @MaxLength(160)
  company!: string;

  @IsString()
  @MaxLength(120)
  role!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
