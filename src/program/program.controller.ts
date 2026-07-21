import { Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { getUserId } from '../common/utils/auth.utils';
import { ProgramService } from './program.service';

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
}
