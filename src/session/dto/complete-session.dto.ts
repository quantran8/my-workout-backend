import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * POST /session/:id/complete — kết buổi.
 *
 * Mọi field optional: client cũ gọi không body vẫn chạy. sessionRpe/energyAfter
 * là cảm nhận CẢ BUỔI (khác actualRpe của từng set) — chỉ thu được ở màn kết
 * thúc nên phải nhận ở đây.
 */
export class CompleteSessionDto {
  /** Mức gắng sức cả buổi, thang 1–10. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  sessionRpe?: number | null;

  @IsOptional()
  @IsIn(['low', 'ok', 'high'])
  energyAfter?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
