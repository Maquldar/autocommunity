import { Body, Param, PipeTransform, Query } from '@nestjs/common';
import { idSchema } from '@autoc/shared';
import type { z } from 'zod';
import { Errors } from '../errors/api-exception';

export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) throw Errors.validation('Invalid request', result.error.issues);
    return result.data;
  }
}

/** Validated `@Body()`; unknown keys are stripped by zod objects. */
export const ZBody = <S extends z.ZodType>(schema: S) => Body(new ZodValidationPipe(schema));
export const ZQuery = <S extends z.ZodType>(schema: S) => Query(new ZodValidationPipe(schema));
export const ZParam = <S extends z.ZodType>(name: string, schema: S) => Param(name, new ZodValidationPipe(schema));
/** Route param that must be a UUID. */
export const IdParam = (name = 'id') => ZParam(name, idSchema);
