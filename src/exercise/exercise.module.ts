import { Module } from '@nestjs/common';
import { ExerciseController } from './exercise.controller';
import { ExercisePublicController } from './exercise.public.controller';
import { ExerciseService } from './exercise.service';

@Module({
  controllers: [ExerciseController, ExercisePublicController],
  providers: [ExerciseService],
  exports: [ExerciseService],
})
export class ExerciseModule {}
