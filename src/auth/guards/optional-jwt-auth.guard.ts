import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard, but never rejects: if a valid token is present the request
 * is authenticated (request.user set), otherwise it proceeds as a GUEST
 * (request.user is undefined). Used for public catalogue routes that serve both
 * visitors and logged-in buyers.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // Override so a missing/invalid token does not throw — the caller is a guest.
  handleRequest(err: any, user: any) {
    return user ?? undefined;
  }
}
