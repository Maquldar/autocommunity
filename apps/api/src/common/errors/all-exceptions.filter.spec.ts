import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Errors } from './api-exception';
import { toErrorResponse } from './all-exceptions.filter';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('db says no', { code, clientVersion: 'test' });

describe('toErrorResponse', () => {
  it('renders ApiException with code and details', () => {
    expect(toErrorResponse(Errors.rateLimited(42))).toEqual({
      status: 429,
      body: { error: { code: 'RATE_LIMITED', message: expect.any(String), details: { retryAfterSec: 42 } } },
    });
  });

  it('maps zod errors to VALIDATION_ERROR with issues', () => {
    const err = z.object({ a: z.string() }).safeParse({}).error!;
    const r = toErrorResponse(err)!;
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details).toEqual(err.issues);
  });

  it('maps Prisma unique violations to CONFLICT and missing records to NOT_FOUND', () => {
    expect(toErrorResponse(prismaError('P2002'))).toMatchObject({ status: 409, body: { error: { code: 'CONFLICT' } } });
    expect(toErrorResponse(prismaError('P2025'))).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND' } } });
    expect(toErrorResponse(prismaError('P1001'))).toBeNull();
  });

  it('maps framework HTTP exceptions to stable codes', () => {
    expect(toErrorResponse(new NotFoundException())).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND' } } });
    expect(toErrorResponse(new PayloadTooLargeException())).toMatchObject({ status: 413, body: { error: { code: 'FILE_TOO_LARGE' } } });
    expect(toErrorResponse(new BadRequestException('x'))).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });
  });

  it('returns null (→ INTERNAL) for unknown errors so internals never leak', () => {
    expect(toErrorResponse(new Error('connection string postgres://secret'))).toBeNull();
    expect(toErrorResponse('boom')).toBeNull();
  });
});
