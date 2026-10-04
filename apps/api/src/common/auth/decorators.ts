import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole } from '@autoc/shared';
import type { Request } from 'express';

export type AuthUser = { id: string; role: UserRole };
export type AuthedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = 'auth:isPublic';
export const ROLES = 'auth:roles';

/** Skips the global JWT guard for this route/controller. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts the route to the given platform roles (checked by RolesGuard). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

/** The authenticated caller (set by JwtAuthGuard). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user;
});
