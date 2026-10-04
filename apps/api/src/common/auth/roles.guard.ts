import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@autoc/shared';
import { Errors } from '../errors/api-exception';
import { ROLES, type AuthedRequest } from './decorators';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw Errors.unauthorized();
    if (!roles.includes(user.role)) throw Errors.forbidden('Insufficient permissions');
    return true;
  }
}
