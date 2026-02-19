import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class GoogleAuthDto {
  @IsEmail()
  @MaxLength(190)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(190)
  name!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  googleSub!: string;

  @IsString()
  @IsIn(['login', 'signup'])
  mode!: 'login' | 'signup';

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  orgName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  planId?: string;
}
