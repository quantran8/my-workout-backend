import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewExerciseDto } from './dto/review-exercise.dto';

/**
 * Fields the client needs to render an exercise: the name and target muscles for
 * a list row, plus instructions/media for the guide sheet. Shared with the
 * session execution join so both surfaces return the identical shape.
 */
export const EXERCISE_DETAIL_SELECT = {
  id: true,
  slug: true,
  name: true,
  exerciseType: true,
  primaryMuscles: true,
  secondaryMuscles: true,
  equipment: true,
  difficulty: true,
  isCompound: true,
  isUnilateral: true,
  instructions: true,
  media: true,
  movementPattern: true,
  contentMode: true,
  defaultRx: true,
} as const;

export type ExerciseDetail = Prisma.ExerciseGetPayload<{
  select: typeof EXERCISE_DETAIL_SELECT;
}>;

@Injectable()
export class ExerciseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Batch read for the client. Only reviewed exercises are visible — the same
   * production-pool condition `ProfileService.buildGuardrail` applies, so the
   * app can never surface a movement a PT has not signed off.
   *
   * Batched by design: a session has ~6 exercises and the practice screen would
   * otherwise issue one request per row.
   */
  async findByIds(ids: string[]): Promise<ExerciseDetail[]> {
    if (ids.length === 0) return [];
    return this.prisma.exercise.findMany({
      where: { id: { in: ids }, reviewedBy: { not: null } },
      select: EXERCISE_DETAIL_SELECT,
    });
  }

  /** Same contract as [findByIds], keyed by the LLM-facing slug. */
  async findBySlugs(slugs: string[]): Promise<ExerciseDetail[]> {
    if (slugs.length === 0) return [];
    return this.prisma.exercise.findMany({
      where: { slug: { in: slugs }, reviewedBy: { not: null } },
      select: EXERCISE_DETAIL_SELECT,
    });
  }

  /**
   * Review queue: unreviewed exercises, ordered so ones WITH contraindication candidates
   * (highest safety risk) come first — mirrors the review_queue view in the SQL schema.
   * Prisma can't order by jsonb_array_length, so we sort in code.
   */
  async reviewQueue() {
    const rows = await this.prisma.exercise.findMany({
      where: { reviewedBy: null },
      select: {
        id: true,
        slug: true,
        name: true,
        movementPattern: true,
        goalFit: true,
        difficulty: true,
        contraindications: true,
      },
    });
    return rows.sort((a, b) => {
      const ac = Array.isArray(a.contraindications)
        ? a.contraindications.length
        : 0;
      const bc = Array.isArray(b.contraindications)
        ? b.contraindications.length
        : 0;
      if (ac !== bc) return bc - ac; // contraindication candidates first
      return a.slug.localeCompare(b.slug);
    });
  }

  /** A PT confirms the heuristic fields and marks the exercise reviewed. */
  async review(id: string, dto: ReviewExerciseDto) {
    const existing = await this.prisma.exercise.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Exercise "${id}" not found`);
    }

    const data: Prisma.ExerciseUpdateInput = {
      reviewedBy: dto.reviewedBy,
      reviewedAt: new Date(),
    };
    if (dto.movementPattern !== undefined)
      data.movementPattern = dto.movementPattern;
    if (dto.goalFit !== undefined) data.goalFit = dto.goalFit;
    if (dto.difficulty !== undefined) data.difficulty = dto.difficulty;
    if (dto.contraindications !== undefined)
      data.contraindications =
        dto.contraindications as unknown as Prisma.InputJsonValue;

    return this.prisma.exercise.update({ where: { id }, data });
  }
}
