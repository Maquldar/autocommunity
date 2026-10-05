import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient<{ log: [{ emit: 'event'; level: 'query' }] }, 'query'>
  implements OnModuleInit, OnApplicationShutdown
{
  /**
   * Number of SQL statements sent so far. Only counted when PRISMA_COUNT_QUERIES=1 (the test suite sets it to
   * bound fan-out work); production doesn't pay for query events.
   */
  queryCount = 0;

  constructor() {
    const counting = process.env.PRISMA_COUNT_QUERIES === '1';
    // The generic pins the 'query' event type; without logging it is simply never emitted.
    super(counting ? { log: [{ emit: 'event', level: 'query' }] } : ({} as { log: [{ emit: 'event'; level: 'query' }] }));
    if (counting) {
      this.$on('query', () => {
        this.queryCount++;
      });
    }
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
