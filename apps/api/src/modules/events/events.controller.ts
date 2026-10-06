import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  communityEventsQuerySchema,
  createEventSchema,
  eventParticipantsQuerySchema,
  eventsQuerySchema,
  mapEventsQuerySchema,
  rsvpSchema,
  updateEventSchema,
  type CreateEventInput,
  type EventDto,
  type EventMapResult,
  type EventParticipantDto,
  type EventsQuery,
  type Paginated,
  type RsvpInput,
  type UpdateEventInput,
} from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { RequireOnboarded } from '../../common/auth/onboarded.guard';
import { IdParam, ZBody, ZQuery } from '../../common/validation/zod.pipe';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @ZQuery(eventsQuerySchema) query: EventsQuery): Promise<Paginated<EventDto>> {
    return this.events.list(user.id, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<EventDto> {
    return this.events.get(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(updateEventSchema) body: UpdateEventInput): Promise<EventDto> {
    return this.events.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<void> {
    return this.events.remove(user.id, id);
  }

  @RequireOnboarded()
  @Post(':id/rsvp')
  @HttpCode(200)
  rsvp(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(rsvpSchema) body: RsvpInput): Promise<EventDto> {
    return this.events.rsvp(user.id, id, body);
  }

  @Get(':id/participants')
  participants(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @ZQuery(eventParticipantsQuerySchema) q: z.output<typeof eventParticipantsQuerySchema>,
  ): Promise<Paginated<EventParticipantDto>> {
    return this.events.participants(user.id, id, q.status, q.cursor, q.limit);
  }
}

@Controller('communities/:id/events')
export class CommunityEventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @ZQuery(communityEventsQuerySchema) q: z.output<typeof communityEventsQuerySchema>,
  ): Promise<Paginated<EventDto>> {
    return this.events.list(user.id, { ...q, communityId: id });
  }

  @RequireOnboarded()
  @Post()
  create(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(createEventSchema) body: CreateEventInput): Promise<EventDto> {
    return this.events.create(user.id, id, body);
  }
}

@Controller('map/events')
export class EventsMapController {
  constructor(private readonly events: EventsService) {}

  @Get()
  map(@CurrentUser() user: AuthUser, @ZQuery(mapEventsQuerySchema) q: z.output<typeof mapEventsQuerySchema>): Promise<EventMapResult> {
    return this.events.map(user.id, q.bbox);
  }
}
