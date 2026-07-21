import { Type } from 'class-transformer';
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type { Constraint, Target } from '../profile.types';

/**
 * PUT /profile — user đã sửa ở màn xác nhận rồi confirm. Ta validate wrapper (constraint
 * là object, target có statedGoals/inferredNeeds) rồi recompute flags/bmi server-side —
 * KHÔNG tin bmi/redFlags từ client.
 */
class TargetDto {
  @IsArray()
  @IsString({ each: true })
  statedGoals!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  problems?: string[];

  @IsArray()
  inferredNeeds!: unknown[];
}

export class UpdateProfileDto {
  @IsObject()
  constraint!: Constraint;

  @ValidateNested()
  @Type(() => TargetDto)
  target!: Target;

  /** Đoạn kể gốc (giữ để audit/re-analyze). */
  @IsOptional()
  @IsString()
  rawOnboarding?: string;
}
