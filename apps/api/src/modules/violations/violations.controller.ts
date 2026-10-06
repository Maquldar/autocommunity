import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  createViolationSchema,
  disputeViolationSchema,
  violationsQuerySchema,
  type CreateViolationInput,
  type DisputeViolationInput,
  type Paginated,
  type VehicleDetailDto,
  type ViolationDto,
} from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/validation/zod.pipe';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RelationService } from '../users/relation.service';
import { UserViewService, userViewInclude } from '../users/user-view.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { ViolationsService } from './violations.service';

type Page = z.output<typeof violationsQuerySchema>;

/** API.md §9.4 — vehicle detail and vehicle violations. */
@Controller('vehicles')
export class VehicleViolationsController {
  constructor(
    private readonly violations: ViolationsService,
    private readonly vehicles: VehiclesService,
    private readonly relations: RelationService,
    private readonly userView: UserViewService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<VehicleDetailDto> {
    const vehicle = await this.violations.requireVehicle(id, user.id);
    const relation = await this.relations.relationFor(user.id, vehicle.userId);
    const [dto, owner, approvedViolations] = await Promise.all([
      this.vehicles.render(vehicle, relation === 'self' || relation === 'friend'),
      this.prisma.user.findUniqueOrThrow({ where: { id: vehicle.userId }, include: userViewInclude }),
      this.prisma.violation.count({ where: { vehicleId: id, status: 'approved' } }),
    ]);
    return { ...dto, owner: this.userView.toMini(owner), approvedViolations };
  }

  @Post(':id/violations')
  submit(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(createViolationSchema) body: CreateViolationInput): Promise<ViolationDto> {
    return this.violations.submit(user.id, id, body);
  }

  @Get(':id/violations')
  list(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZQuery(violationsQuerySchema) q: Page): Promise<Paginated<ViolationDto>> {
    return this.violations.listForVehicle(user.id, id, q);
  }
}

@Controller()
export class ViolationsController {
  constructor(private readonly violations: ViolationsService) {}

  @Get('users/:id/violations')
  forUser(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZQuery(violationsQuerySchema) q: Page): Promise<Paginated<ViolationDto>> {
    return this.violations.listForUser(user.id, id, q);
  }

  @Get('me/violations/submitted')
  submitted(@CurrentUser() user: AuthUser, @ZQuery(violationsQuerySchema) q: Page): Promise<Paginated<ViolationDto>> {
    return this.violations.listSubmitted(user.id, q);
  }

  @Post('violations/:id/dispute')
  @HttpCode(200)
  dispute(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(disputeViolationSchema) body: DisputeViolationInput): Promise<ViolationDto> {
    return this.violations.dispute(user.id, id, body.text);
  }
}
