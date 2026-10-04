import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}

/** Transaction client type for helpers that run inside `prisma.$transaction(async (tx) => …)`. */
export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
