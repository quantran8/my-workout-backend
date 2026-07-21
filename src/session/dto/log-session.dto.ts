import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class LoggedSetDto {
  @IsOptional()
  @IsString()
  prescriptionId?: string | null;

  @IsString()
  exerciseId!: string;

  @IsInt()
  @Min(1)
  setNumber!: number;

  // resistance
  @IsOptional() @IsInt() actualReps?: number | null;
  @IsOptional() @IsNumber() actualWeightKg?: number | null;
  // cardio
  @IsOptional() @IsInt() actualDurationSec?: number | null;
  @IsOptional() @IsInt() actualDistanceM?: number | null;
  @IsOptional() @IsNumber() actualPaceSecPerKm?: number | null;
  @IsOptional() @IsString() stroke?: string | null;
  // mobility
  @IsOptional() @IsString() actualRom?: string | null;

  @IsOptional() @IsInt() actualRpe?: number | null;

  @IsOptional()
  @IsIn(['too_easy', 'too_hard', 'uncomfortable', 'ok'])
  feedbackFlag?: string | null;

  @IsOptional()
  @IsObject()
  fieldSources?: Record<string, string>;
}

export class LogSessionDto {
  @IsOptional()
  @IsString()
  plannedSessionId?: string | null;

  /** revision hiện hành mà buổi này log vào (denormalized). */
  @IsString()
  programRevisionId!: string;

  @IsOptional()
  @IsIn(['outdoor', 'indoor', 'unknown'])
  environment?: string;

  @IsOptional()
  @IsIn(['gps', 'smart_trainer', 'bike_sensor', 'machine_manual', 'none'])
  distanceSource?: string;

  @IsOptional()
  @IsIn(['manual', 'healthkit_phone', 'wearable'])
  dataSource?: string;

  @IsDateString()
  startedAt!: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string | null;

  @IsOptional()
  @IsInt()
  sessionRpe?: number | null;

  @IsOptional()
  @IsIn(['low', 'ok', 'high'])
  energyAfter?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsObject()
  wearable?: Record<string, unknown> | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoggedSetDto)
  sets!: LoggedSetDto[];

  @IsOptional()
  @IsBoolean()
  _unused?: boolean;
}
