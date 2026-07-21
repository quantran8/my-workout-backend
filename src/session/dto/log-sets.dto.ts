import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class SetEntryDto {
  @IsOptional() @IsString() executionItemId?: string | null;
  @IsOptional() @IsString() prescriptionId?: string | null;
  @IsString() exerciseId!: string;
  @IsOptional() @IsString() movementPattern?: string | null;

  @IsInt() @Min(1) setNumber!: number;

  @IsOptional() @IsInt() actualReps?: number | null;
  @IsOptional() @IsNumber() actualWeightKg?: number | null;
  @IsOptional() @IsInt() actualDurationSec?: number | null;
  @IsOptional() @IsInt() actualDistanceM?: number | null;
  @IsOptional() @IsNumber() actualPaceSecPerKm?: number | null;
  @IsOptional() @IsString() stroke?: string | null;
  @IsOptional() @IsString() actualRom?: string | null;
  @IsOptional() @IsInt() actualRpe?: number | null;

  @IsOptional() @IsObject() fieldSources?: Record<string, string>;
}

/** POST /session/:id/sets — log LoggedSet[] (append-able, idempotent theo setNumber+exercise). */
export class LogSetsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SetEntryDto)
  sets!: SetEntryDto[];
}

export type { SetEntryDto };
