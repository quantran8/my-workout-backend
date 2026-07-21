import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseService } from './supabase/supabase.service';
import { PrismaService } from './prisma/prisma.service';
import { TransactionRunner } from './prisma/transaction.runner';
import { AuthModule } from './auth/auth.module';
import { QueueModule } from './queue/queue.module';
import { LlmModule } from './llm/llm.module';
import { ProfileModule } from './profile/profile.module';
import { ExerciseModule } from './exercise/exercise.module';
import { ProgramModule } from './program/program.module';
import { SessionModule } from './session/session.module';

@Global()
@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    QueueModule,
    LlmModule,
    ProfileModule,
    ExerciseModule,
    ProgramModule,
    SessionModule,
  ],
  controllers: [AppController],
  providers: [AppService, SupabaseService, PrismaService, TransactionRunner],
  exports: [SupabaseService, PrismaService, TransactionRunner],
})
export class AppModule {}
