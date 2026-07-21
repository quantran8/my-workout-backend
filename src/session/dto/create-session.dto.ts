import { IsDateString, IsOptional, IsString } from 'class-validator';

/** POST /session/create — tạo vỏ buổi (chưa có set). */
export class CreateSessionDto {
  @IsOptional()
  @IsString()
  plannedSessionId?: string | null;

  @IsString()
  programRevisionId!: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;
}
