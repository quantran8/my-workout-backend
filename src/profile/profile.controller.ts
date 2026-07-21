import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { getUserId } from '../common/utils/auth.utils';
import { ProfileService } from './profile.service';
import { ExtractProfileDto } from './dto/extract-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { Profile } from './profile.types';

@Controller('profile')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /** POST /profile/extract — raw text -> draft + flags (chưa lưu; cho màn xác nhận). */
  @Post('extract')
  extract(@Body() body: ExtractProfileDto) {
    return this.profileService.extractProfile(body.rawText);
  }

  /** PUT /profile — user confirm bản đã sửa; recompute flags + lưu + append history. */
  @Put()
  save(
    @Request() req: { user?: { id: string } },
    @Body() body: UpdateProfileDto,
  ) {
    const profile: Profile = { constraint: body.constraint, target: body.target };
    return this.profileService.saveProfile(
      getUserId(req),
      profile,
      body.rawOnboarding ?? '',
    );
  }

  /** GET /profile — profile hiện hành. */
  @Get()
  get(@Request() req: { user?: { id: string } }) {
    return this.profileService.getProfile(getUserId(req));
  }
}
