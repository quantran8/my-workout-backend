import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import type { AuthUser } from './entities/auth-user.entity';

const DEFAULT_BYPASS_USER_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Guard that uses the Supabase Passport strategy to validate the JWT and set req.user.
 * Use on routes that require authentication.
 */
@Injectable()
export class AuthGuard extends PassportAuthGuard('supabase') {
  private readonly logger = new Logger(AuthGuard.name);

  canActivate(context: ExecutionContext) {
    if (process.env.AUTH_BYPASS_ENABLED === 'true') {
      const request = this.getRequest(context) as { user?: AuthUser };
      request.user = {
        id: process.env.AUTH_BYPASS_USER_ID ?? DEFAULT_BYPASS_USER_ID,
        email: 'local-dev@example.com',
        fullName: 'Local Dev User',
        displayName: 'Local Dev User',
        avatarUrl: null,
        provider: 'email',
      };
      this.logger.warn('Authentication bypass is enabled');
      return true;
    }

    return super.canActivate(context);
  }

  getRequest(context: ExecutionContext) {
    return context.switchToHttp().getRequest();
  }
}
