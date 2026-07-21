import { Module } from '@nestjs/common';
import { ProgramModule } from '../program/program.module';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { FollowupController } from './followup.controller';
import { FollowupService } from './followup.service';

@Module({
  imports: [ProgramModule], // FollowupService dùng ProgramService.reviseForSafety
  controllers: [SessionController, FollowupController],
  providers: [SessionService, FollowupService],
  exports: [SessionService],
})
export class SessionModule {}
