import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import PgBoss from 'pg-boss';

/**
 * pg-boss bootstrap. Runs on the same Postgres ($0 infra) in its own `pgboss` schema.
 *
 * v1 (free tier) does NOT route any job through the queue — program generation runs
 * synchronously in the request. This service exists so the durable-queue infra is in
 * place for the paid tier (progress.rollup.weekly, program.adjust) without a rewrite.
 *
 * enqueue() + registerWorker() are the seams the paid tier will use.
 */
@Injectable()
export class BossService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BossService.name);
  private boss?: PgBoss;

  async onModuleInit(): Promise<void> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      this.logger.warn('DATABASE_URL not set — pg-boss not started');
      return;
    }
    this.boss = new PgBoss({ connectionString });
    this.boss.on('error', (err) => this.logger.error('pg-boss error', err));
    await this.boss.start();
    this.logger.log('pg-boss started');
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop();
  }

  /** Enqueue a job. Returns null if the queue is not running (e.g. no DATABASE_URL). */
  async enqueue<T extends object>(
    name: string,
    data: T,
    options?: PgBoss.SendOptions,
  ): Promise<string | null> {
    if (!this.boss) return null;
    return this.boss.send(name, data, options ?? {});
  }

  /** Register a worker for a job queue. */
  async registerWorker<T extends object>(
    name: string,
    handler: (jobs: PgBoss.Job<T>[]) => Promise<unknown>,
  ): Promise<void> {
    if (!this.boss) return;
    await this.boss.work<T>(name, handler);
  }
}
