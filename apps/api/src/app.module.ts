import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthCoreModule } from './common/auth/auth-core.module';
import { ConfigModule } from './config/config.module';
import { ENV, type Env } from './config/env';
import { loggerOptions } from './config/logger';
import { InfraModule } from './infra/infra.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: (env: Env) => loggerOptions(env) }),
    InfraModule,
    AuthCoreModule,
    AuthModule,
    UsersModule,
    VehiclesModule,
    UploadsModule,
    HealthModule,
  ],
})
export class AppModule {}
