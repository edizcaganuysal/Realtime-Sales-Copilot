import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { Role } from '@live-sales-coach/shared';

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsEnum(Role)
  role!: Role;

  @IsString()
  @MinLength(8)
  password!: string;
}
