import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { getUserId } from '../common/utils/auth.utils';
import { SessionService } from './session.service';
import { LogSessionDto } from './dto/log-session.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { SubmitReadinessDto } from './dto/submit-readiness.dto';
import { LogSetsDto } from './dto/log-sets.dto';
import { RecordFeedbackDto } from './dto/record-feedback.dto';

type Req = { user?: { id: string } };

@Controller('session')
@UseGuards(AuthGuard)
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  /**
   * POST /session — one-shot back-compat (§5): lưu buổi + trả phản hồi-sau-buổi.
   * Client mới dùng các endpoint chi tiết bên dưới.
   */
  @Post()
  log(@Request() req: Req, @Body() body: LogSessionDto) {
    return this.sessionService.logSession(getUserId(req), body);
  }

  /** POST /session/create — tạo vỏ buổi (bước 1 của lifecycle). */
  @Post('create')
  create(@Request() req: Req, @Body() body: CreateSessionDto) {
    return this.sessionService.createSession(getUserId(req), body);
  }

  /** POST /session/:id/readiness — readiness gate (§5.1). */
  @Post(':id/readiness')
  readiness(
    @Request() req: Req,
    @Param('id') id: string,
    @Body() body: SubmitReadinessDto,
  ) {
    return this.sessionService.submitReadiness(getUserId(req), id, body);
  }

  /** POST /session/:id/execution — dựng snapshot bất biến (§5.3). */
  @Post(':id/execution')
  execution(@Request() req: Req, @Param('id') id: string) {
    return this.sessionService.buildExecution(getUserId(req), id);
  }

  /** POST /session/:id/sets — log set. */
  @Post(':id/sets')
  sets(@Request() req: Req, @Param('id') id: string, @Body() body: LogSetsDto) {
    return this.sessionService.logSets(getUserId(req), id, body);
  }

  /** POST /session/:id/feedback — ExerciseFeedbackEvent incl. pain_stop (§5.5, §12.3). */
  @Post(':id/feedback')
  feedback(
    @Request() req: Req,
    @Param('id') id: string,
    @Body() body: RecordFeedbackDto,
  ) {
    return this.sessionService.recordFeedback(getUserId(req), id, body);
  }

  /** POST /session/:id/complete — kết buổi: feedback + tolerance + schedule follow-up. */
  @Post(':id/complete')
  complete(@Request() req: Req, @Param('id') id: string) {
    return this.sessionService.completeSession(getUserId(req), id);
  }

  @Get('history')
  history(
    @Request() req: { user?: { id: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.sessionService.history(getUserId(req), from, to);
  }

  @Get(':id')
  get(@Request() req: { user?: { id: string } }, @Param('id') id: string) {
    return this.sessionService.getSession(getUserId(req), id);
  }
}
