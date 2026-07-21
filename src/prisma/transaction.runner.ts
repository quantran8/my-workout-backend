import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/** Client for use inside $transaction; accepts both PrismaService and tx from $transaction callback. */
export type TxClient = Prisma.TransactionClient;

/**
 * Executes interactive DB transactions. Workflow services use this instead of
 * PrismaService directly so Prisma stays in the persistence layer.
 *
 * @param fn - Receives tx to pass into repository methods.
 * @returns Resolves to fn's return value after commit.
 */
@Injectable()
export class TransactionRunner {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    fn: (tx: TxClient) => Promise<T>,
    options?: { timeout?: number },
  ): Promise<T> {
    return this.prisma.$transaction(fn, {
      timeout: options?.timeout ?? 60_000,
    });
  }
}
