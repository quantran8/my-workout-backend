import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';

/**
 * Guard that uses the Supabase Passport strategy to validate the JWT and set req.user.
 * Use on routes that require authentication.
 */
@Injectable()
export class AuthGuard extends PassportAuthGuard('supabase') {
  getRequest(context: ExecutionContext) {
    return context.switchToHttp().getRequest();
  }
}
