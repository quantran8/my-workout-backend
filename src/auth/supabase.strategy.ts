import { Injectable, OnModuleInit } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-strategy';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

/**
 * Custom Passport strategy for Supabase JWT auth.
 * Verifies the token locally against Supabase's asymmetric signing keys
 * (JWKS), so there is no network round-trip to Supabase per request.
 * The JWKS is fetched once and cached by `jose` (refreshed on key rotation).
 * On success, req.user is the decoded JWT payload ({ sub, email, ... }).
 */
@Injectable()
export class SupabaseStrategy
  extends PassportStrategy(Strategy, 'supabase')
  implements OnModuleInit
{
  private jwks!: JWTVerifyGetKey;

  onModuleInit() {
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL must be provided in environment variables');
    }
    this.jwks = createRemoteJWKSet(
      new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
    );
  }

  validate(): Promise<unknown> {
    return Promise.resolve(undefined);
  }

  authenticate(req: { headers?: { authorization?: string } }): void {
    const authHeader = req.headers?.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;
    if (!token) {
      this.fail({ message: 'Missing authorization' }, 401);
      return;
    }
    jwtVerify(token, this.jwks, { audience: 'authenticated' })
      .then(({ payload }: { payload: JWTPayload }) => {
        this.success(payload, {});
      })
      .catch((err: Error) => {
        this.fail({ message: err?.message ?? 'Invalid token' }, 401);
      });
  }
}

