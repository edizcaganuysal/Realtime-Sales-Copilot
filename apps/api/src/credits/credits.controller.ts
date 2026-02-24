import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  getAllModelCosts,
  estimateCreditsPerMinute,
  estimateRealtimeCreditsPerMinute,
} from '../config/model-costs';

@Controller('credits')
@UseGuards(JwtAuthGuard)
export class CreditsController {
  /**
   * Returns model pricing info + estimated credits per minute for UI display.
   * Any authenticated user can access this — no org-specific data.
   */
  @Get('model-costs')
  getModelCosts() {
    const costs = getAllModelCosts();
    const models = Object.entries(costs).map(([id, cost]) => ({
      id,
      displayName: cost.displayName,
      isRealtime: cost.isRealtime ?? false,
      estimatedCreditsPerMin: cost.isRealtime
        ? estimateRealtimeCreditsPerMinute(id)
        : estimateCreditsPerMinute(id),
    }));
    return { models };
  }
}
