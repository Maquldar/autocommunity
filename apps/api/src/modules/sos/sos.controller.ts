import { Controller, Get, Header, HttpCode, Post, Req } from '@nestjs/common';
import {
  bboxSchema,
  cancelSosSchema,
  createSosSchema,
  paginationQuerySchema,
  sosNearbyQuerySchema,
  type CreateSosInput,
  type Paginated,
  type PublicSosDto,
  type SosDto,
  type SosMapItem,
} from '@autoc/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../../common/auth/decorators';
import { RequireOnboarded } from '../../common/auth/onboarded.guard';
import { IdParam, ZBody, ZParam, ZQuery } from '../../common/validation/zod.pipe';
import { SosService } from './sos.service';

@Controller('sos')
export class SosController {
  constructor(private readonly sos: SosService) {}

  @RequireOnboarded()
  @Post()
  create(@CurrentUser() user: AuthUser, @ZBody(createSosSchema) body: CreateSosInput): Promise<SosDto> {
    return this.sos.create(user.id, body);
  }

  @Get('active')
  active(@CurrentUser() user: AuthUser): Promise<SosDto[]> {
    return this.sos.active(user.id);
  }

  @Get('nearby')
  nearby(@CurrentUser() user: AuthUser, @ZQuery(sosNearbyQuerySchema) q: z.output<typeof sosNearbyQuerySchema>): Promise<SosDto[]> {
    return this.sos.nearby(user.id, q.lat, q.lng);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser, @ZQuery(paginationQuerySchema) q: z.output<typeof paginationQuerySchema>): Promise<Paginated<SosDto>> {
    return this.sos.history(user.id, q.cursor, q.limit);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<SosDto> {
    return this.sos.get(user.id, id);
  }

  @RequireOnboarded()
  @Post(':id/respond')
  @HttpCode(200)
  respond(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<SosDto> {
    return this.sos.respond(user.id, id);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  withdraw(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<SosDto> {
    return this.sos.withdraw(user.id, id);
  }

  @Post(':id/responses/:responseId/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @IdParam() id: string, @IdParam('responseId') responseId: string): Promise<SosDto> {
    return this.sos.accept(user.id, id, responseId);
  }

  @Post(':id/responses/:responseId/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: AuthUser, @IdParam() id: string, @IdParam('responseId') responseId: string): Promise<SosDto> {
    return this.sos.decline(user.id, id, responseId);
  }

  @Post(':id/arrived')
  @HttpCode(200)
  arrived(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<SosDto> {
    return this.sos.arrived(user.id, id);
  }

  @Post(':id/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<SosDto> {
    return this.sos.close(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(cancelSosSchema) body: z.output<typeof cancelSosSchema>): Promise<SosDto> {
    return this.sos.cancel(user.id, id, body.reason);
  }

  @Post(':id/share')
  @HttpCode(200)
  share(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<{ url: string }> {
    return this.sos.share(user.id, id);
  }
}

@Controller('map')
export class SosMapController {
  constructor(private readonly sos: SosService) {}

  @Get('sos')
  map(@CurrentUser() user: AuthUser, @ZQuery(z.object({ bbox: bboxSchema })) q: { bbox: z.output<typeof bboxSchema> }): Promise<{ items: SosMapItem[] }> {
    return this.sos.map(user.id, q.bbox);
  }
}

@Controller('public/sos')
export class PublicSosController {
  constructor(private readonly sos: SosService) {}

  /** Live location data behind a bearer link: never cached by browsers or proxies. */
  @Public()
  @Get(':token')
  @Header('Cache-Control', 'no-store')
  get(@ZParam('token', z.string().max(200)) token: string, @Req() req: Request): Promise<PublicSosDto> {
    return this.sos.publicView(token, req.ip ?? 'unknown');
  }
}
