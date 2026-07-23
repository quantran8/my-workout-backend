import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  /** Supabase yêu cầu tối thiểu 6 ký tự (mặc định). */
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  /** Tên hiển thị, lưu vào user_metadata. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;
}
