import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService],
  // ProgramService consumes buildGuardrail via ProfileService.
  exports: [ProfileService],
})
export class ProfileModule {}
