import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class DiscomfortDto {
  @IsString()
  bodyArea!: string;

  @IsIn(['mild', 'moderate', 'severe'])
  severity!: string;

  @IsBoolean()
  affectsNormalMovement!: boolean;
}

/** POST /session/:id/readiness — câu trả lời readiness của user (§5.1). */
export class SubmitReadinessDto {
  /** false -> nhánh unknown (conservative default). */
  @IsBoolean()
  answered!: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiscomfortDto)
  discomforts?: DiscomfortDto[];

  @IsOptional()
  @IsIn(['none', 'mild', 'moderate', 'high'])
  residualSoreness?: string | null;

  @IsOptional()
  @IsIn(['low', 'ok', 'high'])
  energyLevel?: string | null;

  @IsOptional()
  @IsObject()
  externalLoads?: {
    poorSleep?: boolean;
    highStress?: boolean;
    illness?: boolean;
  } | null;
}
