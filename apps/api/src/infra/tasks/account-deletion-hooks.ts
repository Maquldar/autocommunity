import { Injectable } from '@nestjs/common';

type Hook = { name: string; run: (userId: string) => Promise<void> };

/**
 * Feature modules register work that must happen before an account is deleted (e.g. the SOS module
 * cancels the user's open SOS and withdraws their responses, with the usual notifications). Kept in infra so
 * UsersService doesn't depend on every feature module (which already depend on it).
 */
@Injectable()
export class AccountDeletionHooks {
  private readonly hooks: Hook[] = [];

  register(name: string, run: (userId: string) => Promise<void>): void {
    this.hooks.push({ name, run });
  }

  /** Runs every hook in registration order; a failing hook aborts the deletion (nothing is half-deleted). */
  async run(userId: string): Promise<void> {
    for (const h of this.hooks) await h.run(userId);
  }
}
