import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { Role } from '@live-sales-coach/shared';

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}
