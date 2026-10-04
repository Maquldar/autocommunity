import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { updateVehicleSchema, vehicleSchema, type VehicleDto, type VehicleInput } from '@autoc/shared';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { IdParam, ZBody } from '../../common/validation/zod.pipe';
import { VehiclesService } from './vehicles.service';

@Controller('me/vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<VehicleDto[]> {
    return this.vehicles.list(user.id, true);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @ZBody(vehicleSchema) body: VehicleInput): Promise<VehicleDto> {
    return this.vehicles.create(user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @ZBody(updateVehicleSchema) body: Partial<VehicleInput>,
  ): Promise<VehicleDto> {
    return this.vehicles.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<void> {
    await this.vehicles.remove(user.id, id);
  }
}
