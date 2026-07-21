import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ExerciseService } from './exercise.service';
import { ReviewExerciseDto } from './dto/review-exercise.dto';

/**
 * Admin / PT review surface for the movement library. Behind AuthGuard.
 * (A stricter admin-role guard can be layered later; out of scope for the free-tier build.)
 */
@Controller('admin/exercises')
@UseGuards(AuthGuard)
export class ExerciseController {
  constructor(private readonly exerciseService: ExerciseService) {}

  @Get('review-queue')
  reviewQueue() {
    return this.exerciseService.reviewQueue();
  }

  @Patch(':id/review')
  review(@Param('id') id: string, @Body() body: ReviewExerciseDto) {
    return this.exerciseService.review(id, body);
  }
}
