import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// PrismaService is provided by the @Global() AppModule, so this module injects
// it without re-providing. It reads only Prisma directly — no imports needed.
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
