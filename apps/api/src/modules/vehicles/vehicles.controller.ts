import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { updateVehicleBodySchema, vehicleBodySchema, type OwnVehicleDto, type VehicleInput } from '@autoc/shared';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { IdParam, ZBody } from '../../common/validation/zod.pipe';
import { VehiclesService } from './vehicles.service';

@Controller('me/vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<OwnVehicleDto[]> {
    return this.vehicles.listOwn(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @ZBody(vehicleBodySchema) body: VehicleInput): Promise<OwnVehicleDto> {
    return this.vehicles.create(user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @ZBody(updateVehicleBodySchema) body: Partial<VehicleInput>,
  ): Promise<OwnVehicleDto> {
    return this.vehicles.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<void> {
    await this.vehicles.remove(user.id, id);
  }
}
