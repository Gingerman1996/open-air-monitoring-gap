import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { runIngest } from './ingest';
import { runReferenceRefresh } from './reference';

/**
 * BullMQ-backed scheduled refreshes, both gated by INGEST_SCHEDULE:
 *   - monitors:   re-pull the AirGradient sensors every INGEST_INTERVAL_MS (default 10 min).
 *   - reference:  re-pull World Bank population + WHO deaths/DALYs on REFERENCE_CRON
 *                 (default the 1st of each month, Asia/Bangkok) — those are annual datasets.
 * The boot-time INGEST_ON_START / REFERENCE_ON_START give an immediate first load; these keep
 * them fresh after.
 */
const MONITOR_QUEUE = 'ingest';
const REFERENCE_QUEUE = 'reference';
const JOB = 'refresh';
const EVERY_MS = Number(process.env.INGEST_INTERVAL_MS ?? 10 * 60 * 1000);
const REFERENCE_CRON = process.env.REFERENCE_CRON ?? '0 0 1 * *';
const REFERENCE_TZ = process.env.REFERENCE_TZ ?? 'Asia/Bangkok';

@Injectable()
export class IngestScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('IngestScheduler');
  private readonly queues: Queue[] = [];
  private readonly workers: Worker[] = [];

  async onModuleInit(): Promise<void> {
    if (process.env.INGEST_SCHEDULE !== 'true') return;

    const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    // pass options (not a shared instance) so BullMQ owns separate connections for queue vs worker
    const connection = { host: url.hostname, port: Number(url.port || 6379) };

    await this.schedule(
      connection,
      MONITOR_QUEUE,
      { every: EVERY_MS },
      async () => {
        this.logger.log('scheduled refresh — pulling live monitors');
        await runIngest();
      },
      `monitor refresh scheduled every ${Math.round(EVERY_MS / 60000)} min`,
    );

    await this.schedule(
      connection,
      REFERENCE_QUEUE,
      { pattern: REFERENCE_CRON, tz: REFERENCE_TZ },
      async () => {
        this.logger.log('scheduled refresh — pulling reference data (population, deaths, DALYs)');
        await runReferenceRefresh();
      },
      `reference refresh scheduled at cron '${REFERENCE_CRON}' (${REFERENCE_TZ})`,
    );
  }

  private async schedule(
    connection: { host: string; port: number },
    name: string,
    repeat: { every: number } | { pattern: string; tz: string },
    handler: () => Promise<void>,
    announce: string,
  ): Promise<void> {
    const queue = new Queue(name, { connection });
    // clean slate (single-purpose queue): drops any prior schedule + leftover delayed jobs,
    // so changing the interval/cron never leaves a zombie repeat firing
    await queue
      .obliterate({ force: true })
      .catch((err) => this.logger.warn(`could not reset ${name} queue: ${(err as Error).message}`));

    const worker = new Worker(name, handler, { connection, concurrency: 1 });
    worker.on('completed', () => this.logger.log(`${name} refresh complete`));
    worker.on('failed', (_job, err) =>
      this.logger.warn(`${name} refresh failed (keeping last data): ${err?.message}`),
    );

    await queue.add(JOB, {}, { repeat, removeOnComplete: true, removeOnFail: 20 });
    this.queues.push(queue);
    this.workers.push(worker);
    this.logger.log(announce);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all(this.queues.map((q) => q.close()));
  }
}
