import { UnauthorizedException } from '@nestjs/common';

/**
 * Extracts authenticated user id from request. Use in controllers to pass userId to services.
 * Throws UnauthorizedException if user is not authenticated.
 */
export function getUserId(req: { user?: { id: string } }): string {
  const id = req?.user?.id;
  if (id == null || id === '') {
    throw new UnauthorizedException('User not authenticated');
  }
  return id;
}
