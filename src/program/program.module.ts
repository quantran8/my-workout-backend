import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { ProgramController } from './program.controller';
import { ProgramService } from './program.service';

@Module({
  imports: [ProfileModule], // consumes ProfileService.buildGuardrail
  controllers: [ProgramController],
  providers: [ProgramService],
  exports: [ProgramService],
})
export class ProgramModule {}
