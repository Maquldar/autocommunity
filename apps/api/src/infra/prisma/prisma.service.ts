import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient<{ log: [{ emit: 'event'; level: 'query' }] }, 'query'>
  implements OnModuleInit, OnApplicationShutdown
{
  /** Number of SQL statements sent so far (cheap counter; used by tests to bound fan-out work). */
  queryCount = 0;

  constructor() {
    super({ log: [{ emit: 'event', level: 'query' }] });
    this.$on('query', () => {
      this.queryCount++;
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}

/** Transaction client type for helpers that run inside `prisma.$transaction(async (tx) => …)`. */
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
