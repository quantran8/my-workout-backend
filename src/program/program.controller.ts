import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { getUserId } from '../common/utils/auth.utils';
import { ProgramService } from './program.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Controller('program')
@UseGuards(AuthGuard)
export class ProgramController {
  constructor(private readonly programService: ProgramService) {}

  /** POST /program/generate — gen static program (đồng bộ: guardrail -> LLM -> validate/repair). */
  @Post('generate')
  generate(@Request() req: { user?: { id: string } }) {
    return this.programService.generateStaticProgram(getUserId(req));
  }

  /** GET /program/active — program + revision hiện hành. */
  @Get('active')
  active(@Request() req: { user?: { id: string } }) {
    return this.programService.getActive(getUserId(req));
  }

  /**
   * GET /program/current?date=YYYY-MM-DD — buổi cần làm hiện tại + buổi kế tiếp + tiến độ.
   * date tùy chọn (mặc định hôm nay, UTC); sai định dạng -> 400 rõ ràng thay vì im lặng
   * lệch ngày.
   */
  @Get('current')
  current(
    @Request() req: { user?: { id: string } },
    @Query('date') date?: string,
  ) {
    if (date != null && !DATE_RE.test(date)) {
      throw new BadRequestException('date phải theo định dạng YYYY-MM-DD');
    }
    return this.programService.getCurrent(getUserId(req), date);
  }
}
