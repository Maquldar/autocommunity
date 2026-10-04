import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadDotEnv, parseEnvOrThrow } from './config/env';

async function main(): Promise<void> {
  loadDotEnv();
  const env = parseEnvOrThrow();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app, env);
  await app.listen(env.API_PORT);
  app.get(Logger).log(`API listening on :${env.API_PORT}`, 'Bootstrap');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
