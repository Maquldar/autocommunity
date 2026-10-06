import { Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  adminAuditQuerySchema,
  adminBlockSchema,
  adminCommunitiesQuerySchema,
  adminFraudFlagsQuerySchema,
  adminNoteBodySchema,
  adminReportsQuerySchema,
  adminResolveReportSchema,
  adminServicesQuerySchema,
  adminSosBanSchema,
  adminSosQuerySchema,
  adminUsersQuerySchema,
  adminVisitsQuerySchema,
  type AdminActionDto,
  type AdminBlockInput,
  type AdminCommunityDto,
  type AdminNoteInput,
  type AdminReportDto,
  type AdminResolveReportInput,
  type AdminResolveResult,
  type AdminServiceDto,
  type AdminServiceQrDto,
  type AdminSosBanInput,
  type AdminSosDetail,
  type AdminSosRow,
  type AdminStatsDto,
  type AdminUserDetail,
  type AdminUserRow,
  type AdminVisitDto,
  type FraudFlagDto,
  type Paginated,
} from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/validation/zod.pipe';
import { AdminAuditService } from './admin-audit.service';
import { AdminModerationService } from './admin-moderation.service';
import { AdminRateLimitGuard } from './admin-rate-limit.guard';
import { AdminServicesService } from './admin-services.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';

/** API.md §6 — every route requires role=admin (403 FORBIDDEN otherwise), 300 requests/min per admin. */
@Controller('admin')
@Roles('admin')
@UseGuards(AdminRateLimitGuard)
export class AdminController {
  constructor(
    private readonly stats: AdminStatsService,
    private readonly users: AdminUsersService,
    private readonly moderation: AdminModerationService,
    private readonly services: AdminServicesService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('stats')
  getStats(): Promise<AdminStatsDto> {
    return this.stats.get();
  }

  /* users */

  @Get('users')
  listUsers(@ZQuery(adminUsersQuerySchema) q: z.output<typeof adminUsersQuerySchema>): Promise<Paginated<AdminUserRow>> {
    return this.users.list(q);
  }

  @Get('users/:id')
  getUser(@IdParam() id: string): Promise<AdminUserDetail> {
    return this.users.detail(id);
  }

  @Post('users/:id/warn')
  @HttpCode(200)
  warn(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<AdminUserDetail> {
    return this.users.warn(admin.id, id, body.note);
  }

  @Post('users/:id/block')
  @HttpCode(200)
  block(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminBlockSchema) body: AdminBlockInput): Promise<AdminUserDetail> {
    return this.users.block(admin.id, id, body);
  }

  @Post('users/:id/unblock')
  @HttpCode(200)
  unblock(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<AdminUserDetail> {
    return this.users.unblock(admin.id, id, body.note);
  }

  @Post('users/:id/sos-ban')
  @HttpCode(200)
  sosBan(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminSosBanSchema) body: AdminSosBanInput): Promise<AdminUserDetail> {
    return this.users.sosBan(admin.id, id, body);
  }

  @Post('users/:id/sos-unban')
  @HttpCode(200)
  sosUnban(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<AdminUserDetail> {
    return this.users.sosUnban(admin.id, id, body.note);
  }

  /* communities */

  @Get('communities')
  listCommunities(@ZQuery(adminCommunitiesQuerySchema) q: z.output<typeof adminCommunitiesQuerySchema>): Promise<Paginated<AdminCommunityDto>> {
    return this.moderation.communities(q);
  }

  @Delete('communities/:id')
  @HttpCode(204)
  deleteCommunity(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<void> {
    return this.moderation.deleteCommunity(admin.id, id, body.note);
  }

  /* SOS */

  @Get('sos')
  listSos(@ZQuery(adminSosQuerySchema) q: z.output<typeof adminSosQuerySchema>): Promise<Paginated<AdminSosRow>> {
    return this.moderation.sosList(q);
  }

  @Get('sos/:id')
  getSos(@IdParam() id: string): Promise<AdminSosDetail> {
    return this.moderation.sosDetail(id);
  }

  @Post('sos/:id/mark-fake')
  @HttpCode(200)
  markFake(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<AdminSosDetail> {
    return this.moderation.markFake(admin.id, id, body.note);
  }

  /* reports */

  @Get('reports')
  listReports(@ZQuery(adminReportsQuerySchema) q: z.output<typeof adminReportsQuerySchema>): Promise<Paginated<AdminReportDto>> {
    return this.moderation.reports(q);
  }

  @Post('reports/:id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminResolveReportSchema) body: AdminResolveReportInput): Promise<AdminResolveResult> {
    return this.moderation.resolve(admin.id, id, body);
  }

  /* fraud flags, audit */

  @Get('fraud-flags')
  listFraudFlags(@ZQuery(adminFraudFlagsQuerySchema) q: z.output<typeof adminFraudFlagsQuerySchema>): Promise<Paginated<FraudFlagDto>> {
    return this.moderation.fraudFlags(q);
  }

  @Get('audit')
  listAudit(@ZQuery(adminAuditQuerySchema) q: z.output<typeof adminAuditQuerySchema>): Promise<Paginated<AdminActionDto>> {
    return this.audit.list(q);
  }

  /* services and photo visits */

  @Get('services')
  listServices(@ZQuery(adminServicesQuerySchema) q: z.output<typeof adminServicesQuerySchema>): Promise<Paginated<AdminServiceDto>> {
    return this.services.list(q);
  }

  @Get('services/:id')
  getService(@IdParam() id: string): Promise<AdminServiceDto> {
    return this.services.get(id);
  }

  @Post('services/:id/verify')
  @HttpCode(200)
  verifyService(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<AdminServiceDto> {
    return this.services.setStatus(admin.id, id, 'verified', body.note);
  }

  @Post('services/:id/reject')
  @HttpCode(200)
  rejectService(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<AdminServiceDto> {
    return this.services.setStatus(admin.id, id, 'rejected', body.note);
  }

  @Get('services/:id/qr')
  serviceQr(@IdParam() id: string): Promise<AdminServiceQrDto> {
    return this.services.qr(id);
  }

  @Get('visits')
  listVisits(@ZQuery(adminVisitsQuerySchema) q: z.output<typeof adminVisitsQuerySchema>): Promise<Paginated<AdminVisitDto>> {
    return this.services.visits(q);
  }

  @Post('visits/:id/approve')
  @HttpCode(200)
  approveVisit(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<AdminVisitDto> {
    return this.services.setVisitStatus(admin.id, id, 'verified', body.note);
  }

  @Post('visits/:id/reject')
  @HttpCode(200)
  rejectVisit(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<AdminVisitDto> {
    return this.services.setVisitStatus(admin.id, id, 'rejected', body.note);
  }
}
