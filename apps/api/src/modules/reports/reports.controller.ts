import { Controller, Get, Post } from '@nestjs/common';
import { createReportSchema, paginationQuerySchema, type CreateReportInput, type Paginated, type ReportDto } from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { ZBody, ZQuery } from '../../common/validation/zod.pipe';
import { ReportsService } from './reports.service';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('reports')
  create(@CurrentUser() user: AuthUser, @ZBody(createReportSchema) body: CreateReportInput): Promise<ReportDto> {
    return this.reports.create(user.id, body);
  }

  @Get('me/reports')
  mine(@CurrentUser() user: AuthUser, @ZQuery(paginationQuerySchema) q: z.output<typeof paginationQuerySchema>): Promise<Paginated<ReportDto>> {
    return this.reports.mine(user.id, q.cursor, q.limit);
  }
}
