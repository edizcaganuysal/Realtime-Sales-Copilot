import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '@live-sales-coach/shared';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    return ctx.switchToHttp().getRequest().user;
  },
);
