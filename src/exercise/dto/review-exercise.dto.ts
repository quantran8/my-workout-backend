import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

class ContraindicationDto {
  @IsString()
  injuryArea!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * PATCH /admin/exercises/:id/review — a PT confirms the heuristic fields and marks the
 * exercise reviewed (sets reviewedBy/reviewedAt server-side). Optional fields let the PT
 * correct pattern / goalFit / contraindications before it enters the production pool.
 */
export class ReviewExerciseDto {
  /** Who is reviewing (PT id / name). */
  @IsString()
  reviewedBy!: string;

  @IsOptional()
  @IsString()
  movementPattern?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  goalFit?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContraindicationDto)
  contraindications?: ContraindicationDto[];
}
