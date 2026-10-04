import { Controller, Get } from '@nestjs/common';
import { userSearchQuerySchema, type Paginated, type UserPublic, type VehicleDto } from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { IdParam, ZQuery } from '../../common/validation/zod.pipe';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  search(
    @CurrentUser() user: AuthUser,
    @ZQuery(userSearchQuerySchema) query: z.output<typeof userSearchQuerySchema>,
  ): Promise<Paginated<UserPublic>> {
    return this.users.search(user.id, query.q, query.cursor, query.limit);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<UserPublic> {
    return this.users.getPublic(user.id, id);
  }

  @Get(':id/vehicles')
  vehicles(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<VehicleDto[]> {
    return this.users.listVehicles(user.id, id);
  }
}
