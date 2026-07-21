import { IsNotEmpty, IsString } from 'class-validator';

export class ExtractProfileDto {
  /** Đoạn người dùng tự kể về bản thân + mục tiêu (raw onboarding text). */
  @IsString()
  @IsNotEmpty()
  rawText!: string;
}
