import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

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

  /**
   * §5B — thu TỪ ĐẦU buổi, không suy ngược lúc kết thúc: ngoài trời/trong nhà
   * đổi cách diễn giải pace và quãng đường.
   */
  @IsOptional()
  @IsIn(['outdoor', 'indoor', 'unknown'])
  environment?: string;

  /** Tách khỏi wearable: nguồn đo quãng đường quyết định độ tin của distance. */
  @IsOptional()
  @IsIn(['gps', 'smart_trainer', 'bike_sensor', 'machine_manual', 'none'])
  distanceSource?: string;

  @IsOptional()
  @IsIn(['manual', 'healthkit_phone', 'wearable'])
  dataSource?: string;
}
