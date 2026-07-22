import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewExerciseDto } from './dto/review-exercise.dto';

@Injectable()
export class ExerciseService {
  constructor(private readonly prisma: PrismaService) {}

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
