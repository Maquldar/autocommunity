import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Errors } from '../errors/api-exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { BackgroundTasks } from '../../infra/tasks/background-tasks';
import { AccessTokenService } from './access-token.service';
import { IS_PUBLIC, type AuthedRequest } from './decorators';
import { isUserBlocked, UserStateService } from './user-state.service';

const ACTIVITY_THROTTLE_SEC = 5 * 60;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly userState: UserStateService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly tasks: BackgroundTasks,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '')?.[1];
    if (!token) throw Errors.unauthorized();

    const claims = await this.tokens.verify(token);
    if (!claims) throw Errors.unauthorized('Invalid or expired access token');

    const { state, revokedBeforeMs } = await this.userState.getForAuth(claims.sub);
    if (!state) throw Errors.unauthorized('Invalid or expired access token');
    if (revokedBeforeMs !== null && claims.issuedAtMs <= revokedBeforeMs) {
      throw Errors.unauthorized('Session has been revoked');
    }
    if (isUserBlocked(state)) throw Errors.accountBlocked();

    req.user = { id: claims.sub, role: state.role };
    this.touchActivity(claims.sub);
    return true;
  }

  /** Updates lastActiveAt at most once per 5 minutes per user; never blocks the request. */
  private touchActivity(userId: string): void {
    this.tasks.run('lastActiveAt update', async () => {
      const set = await this.redis.set(`user:active:${userId}`, '1', 'EX', ACTIVITY_THROTTLE_SEC, 'NX');
      if (set === 'OK') await this.prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() }, select: { id: true } });
    });
  }
}
