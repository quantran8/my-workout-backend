import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/** POST /session/:id/feedback — một ExerciseFeedbackEvent (§5.5, gồm pain_stop). */
export class RecordFeedbackDto {
  @IsOptional()
  @IsString()
  executionItemId?: string | null;

  @IsOptional()
  @IsString()
  setId?: string | null;

  @IsString()
  exerciseId!: string;

  @IsOptional()
  @IsString()
  movementPattern?: string | null;

  @IsIn(['too_easy', 'too_hard', 'uncomfortable', 'pain_stop', 'ok'])
  type!: string;

  @IsOptional()
  @IsString()
  bodyArea?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  severity?: number | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  /** với pain_stop: cơn đau lan sang pattern liên quan (interpreter thô, không phải verdict). */
  @IsOptional()
  @IsBoolean()
  spreadsToRelatedPattern?: boolean;
}
