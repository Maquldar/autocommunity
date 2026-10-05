import { Controller, Get } from '@nestjs/common';
import { mapUsersQuerySchema, type MapUser, type MapUsersQuery } from '@autoc/shared';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { ZQuery } from '../../common/validation/zod.pipe';
import { MapService } from './map.service';

@Controller('map')
export class MapController {
  constructor(private readonly map: MapService) {}

  @Get('users')
  users(@CurrentUser() user: AuthUser, @ZQuery(mapUsersQuerySchema) query: MapUsersQuery): Promise<{ items: MapUser[]; truncated: boolean }> {
    return this.map.users(user.id, query);
  }
}
