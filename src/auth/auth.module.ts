import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseStrategy } from './supabase.strategy';
import { TokenVerifierService } from './token-verifier.service';

@Module({
  imports: [PassportModule],
  controllers: [AuthController],
  providers: [TokenVerifierService, SupabaseStrategy, AuthService],
  exports: [TokenVerifierService, SupabaseStrategy, AuthService],
})
export class AuthModule {}
