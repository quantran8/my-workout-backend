import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { SupabaseStrategy } from './supabase.strategy';
import { TokenVerifierService } from './token-verifier.service';

@Module({
  imports: [PassportModule],
  providers: [TokenVerifierService, SupabaseStrategy],
  exports: [TokenVerifierService, SupabaseStrategy],
})
export class AuthModule {}
