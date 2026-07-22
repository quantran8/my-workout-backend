import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-strategy';
import { TokenVerifierService } from './token-verifier.service';

/**
 * Custom Passport strategy for Supabase JWT auth.
 * Verifies the token locally against Supabase's asymmetric signing keys
 * (JWKS), so there is no network round-trip to Supabase per request.
 * The JWKS is fetched once and cached by `jose` (refreshed on key rotation).
 * On success, req.user is the decoded JWT payload ({ sub, email, ... }).
 */
@Injectable()
export class SupabaseStrategy extends PassportStrategy(Strategy, 'supabase') {
  constructor(private readonly tokenVerifier: TokenVerifierService) {
    super();
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
    this.tokenVerifier
      .verify(token)
      .then((user) => {
        this.success(user, {});
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Invalid token';
        this.fail({ message }, 401);
      });
  }
}
