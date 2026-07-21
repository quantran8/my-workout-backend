import { IsBoolean } from 'class-validator';

/** POST /followup/:id/complete — phản ứng ngày hôm sau (§5.6). */
export class CompleteFollowupDto {
  @IsBoolean()
  feelWorse!: boolean;

  @IsBoolean()
  newPainAppeared!: boolean;

  @IsBoolean()
  sorenessLingering!: boolean;

  @IsBoolean()
  recoveredWell!: boolean;
}
