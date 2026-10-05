import { Controller, Get, Post } from '@nestjs/common';
import {
  createServiceReviewSchema,
  createServiceSchema,
  createVisitSchema,
  paginationQuerySchema,
  serviceDetailsQuerySchema,
  serviceListQuerySchema,
  serviceMapQuerySchema,
  type Paginated,
  type ServiceDto,
  type ServiceListItem,
  type ServiceMapResult,
  type ServiceQrDto,
  type ServiceReviewDto,
  type VisitDto,
} from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/validation/zod.pipe';
import { ServiceReviewsService } from './reviews.service';
import { ServicesService } from './services.service';
import { VisitsService } from './visits.service';

@Controller('services')
export class ServicesController {
  constructor(
    private readonly services: ServicesService,
    private readonly visits: VisitsService,
    private readonly reviews: ServiceReviewsService,
  ) {}

  @Get()
  list(@ZQuery(serviceListQuerySchema) query: z.output<typeof serviceListQuerySchema>): Promise<Paginated<ServiceListItem>> {
    return this.services.list(query);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @ZBody(createServiceSchema) body: z.output<typeof createServiceSchema>): Promise<ServiceDto> {
    return this.services.create(user, body);
  }

  @Get(':id')
  details(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @ZQuery(serviceDetailsQuerySchema) query: z.output<typeof serviceDetailsQuerySchema>,
  ): Promise<ServiceDto> {
    const at = query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : undefined;
    return this.services.details(user, id, at);
  }

  @Get(':id/reviews')
  listReviews(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @ZQuery(paginationQuerySchema) query: z.output<typeof paginationQuerySchema>,
  ): Promise<Paginated<ServiceReviewDto>> {
    return this.reviews.list(user, id, query.cursor, query.limit);
  }

  @Post(':id/reviews')
  createReview(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @ZBody(createServiceReviewSchema) body: z.output<typeof createServiceReviewSchema>,
  ): Promise<ServiceReviewDto> {
    return this.reviews.create(user, id, body);
  }

  @Post(':id/visits')
  createVisit(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @ZBody(createVisitSchema) body: z.output<typeof createVisitSchema>,
  ): Promise<VisitDto> {
    return this.visits.create(user, id, body);
  }

  @Get(':id/qr')
  @Roles('admin')
  qr(@IdParam() id: string): Promise<ServiceQrDto> {
    return this.services.qr(id);
  }
}

@Controller('map/services')
export class ServicesMapController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  map(@ZQuery(serviceMapQuerySchema) query: z.output<typeof serviceMapQuerySchema>): Promise<ServiceMapResult> {
    return this.services.map(query);
  }
}
