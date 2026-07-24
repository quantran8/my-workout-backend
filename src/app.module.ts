import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
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
import { DashboardModule } from './dashboard/dashboard.module';
import { HttpLoggingInterceptor } from './common/interceptors/http-logging.interceptor';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    QueueModule,
    LlmModule,
    ProfileModule,
    ExerciseModule,
    ProgramModule,
    SessionModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    SupabaseService,
    PrismaService,
    TransactionRunner,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },
  ],
  exports: [SupabaseService, PrismaService, TransactionRunner],
})
export class AppModule {}
