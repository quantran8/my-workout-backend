import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { getUserId } from '../common/utils/auth.utils';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** GET /dashboard — the aggregate the mobile Home screen renders. */
  @Get()
  get(@Request() req: { user?: { id: string } }) {
    return this.dashboardService.getDashboard(getUserId(req));
  }
}
