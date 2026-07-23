import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ExerciseService } from './exercise.service';

/** Guard against an unbounded `IN (...)` from a malformed client request. */
const MAX_IDS = 100;

/**
 * Read surface for the movement library, consumed by the practice screens
 * (exercise list, guide sheet). Only reviewed exercises are returned — see
 * `ExerciseService.findByIds`.
 */
@Controller('exercises')
@UseGuards(AuthGuard)
export class ExercisePublicController {
  constructor(private readonly exerciseService: ExerciseService) {}

  /**
   * GET /exercises?ids=a,b,c — batch read. `slugs=` is accepted as an
   * alternative key for callers holding the LLM-facing slug instead of the uuid.
   *
   * Unknown ids are silently absent from the response rather than an error: the
   * caller renders whatever resolved, and a since-unreviewed exercise should not
   * fail the whole session load.
   */
  @Get()
  find(@Query('ids') ids?: string, @Query('slugs') slugs?: string) {
    const idList = splitCsv(ids);
    const slugList = splitCsv(slugs);

    if (idList.length === 0 && slugList.length === 0) {
      throw new BadRequestException('Provide either "ids" or "slugs"');
    }
    if (idList.length > MAX_IDS || slugList.length > MAX_IDS) {
      throw new BadRequestException(`At most ${MAX_IDS} ids per request`);
    }

    return idList.length > 0
      ? this.exerciseService.findByIds(idList)
      : this.exerciseService.findBySlugs(slugList);
  }

  /** GET /exercises/:id — single read, for the guide sheet opened by id. */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const [exercise] = await this.exerciseService.findByIds([id]);
    if (!exercise) throw new NotFoundException(`Exercise "${id}" not found`);
    return exercise;
  }
}

function splitCsv(value?: string): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  ];
}
