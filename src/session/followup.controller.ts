import { Body, Controller, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { getUserId } from '../common/utils/auth.utils';
import { FollowupService } from './followup.service';
import { CompleteFollowupDto } from './dto/complete-followup.dto';

type Req = { user?: { id: string } };

@Controller('followup')
@UseGuards(AuthGuard)
export class FollowupController {
  constructor(private readonly followupService: FollowupService) {}

  /** POST /followup/:id/complete — phản ứng ngày sau -> final tolerance + safety decision. */
  @Post(':id/complete')
  complete(
    @Request() req: Req,
    @Param('id') id: string,
    @Body() body: CompleteFollowupDto,
  ) {
    return this.followupService.complete(getUserId(req), id, body);
  }
}
