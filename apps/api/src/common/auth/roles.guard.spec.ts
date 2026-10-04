import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../errors/api-exception';
import type { AuthUser } from './decorators';
import { RolesGuard } from './roles.guard';

const ctx = (user: AuthUser | undefined, roles: string[] | undefined) => {
  const handler = () => undefined;
  if (roles) Reflect.defineMetadata('auth:roles', roles, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
};

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows routes without @Roles', () => {
    expect(guard.canActivate(ctx({ id: 'u', role: 'user' }, undefined))).toBe(true);
  });

  it('allows admins and forbids users on admin routes', () => {
    expect(guard.canActivate(ctx({ id: 'u', role: 'admin' }, ['admin']))).toBe(true);
    expect(() => guard.canActivate(ctx({ id: 'u', role: 'user' }, ['admin']))).toThrow(ApiException);
  });
});
