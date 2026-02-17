import { SetMetadata } from '@nestjs/common';
import type { Role } from '@live-sales-coach/shared';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
