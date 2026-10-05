import { Controller, Delete, HttpCode, Put } from '@nestjs/common';
import { updateLocationSchema } from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { ZBody } from '../../common/validation/zod.pipe';
import { LocationService } from './location.service';

@Controller('me/location')
export class LocationController {
  constructor(private readonly location: LocationService) {}

  @Put()
  @HttpCode(204)
  async update(@CurrentUser() user: AuthUser, @ZBody(updateLocationSchema) body: z.output<typeof updateLocationSchema>): Promise<void> {
    await this.location.update(user.id, body);
  }

  @Delete()
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser): Promise<void> {
    return this.location.remove(user.id);
  }
}
