import { Global, Module } from '@nestjs/common';
import { ENV, parseEnvOrThrow } from './env';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => parseEnvOrThrow() }],
  exports: [ENV],
})
export class ConfigModule {}
