import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { runIngest } from './ingest';

/**
 * BullMQ-backed scheduled refresh: a repeatable job re-pulls the AirGradient
 * monitors every INGEST_INTERVAL_MS (default 10 min). The boot-time ingest
 * (INGEST_ON_START) gives an immediate first load; this keeps it fresh after.
 * Gated by INGEST_SCHEDULE so local dev doesn't spin a worker unless asked.
 */
const QUEUE = 'ingest';
const JOB = 'refresh';
const EVERY_MS = Number(process.env.INGEST_INTERVAL_MS ?? 10 * 60 * 1000);

@Injectable()
export class IngestScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('IngestScheduler');
  private queue?: Queue;
  private worker?: Worker;

  async onModuleInit(): Promise<void> {
    if (process.env.INGEST_SCHEDULE !== 'true') return;

    const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    // pass options (not a shared instance) so BullMQ owns separate connections for queue vs worker
    const connection = { host: url.hostname, port: Number(url.port || 6379) };

    this.queue = new Queue(QUEUE, { connection });
    // clean slate (single-purpose queue): drops any prior schedule + leftover delayed jobs,
    // so changing the interval never leaves a zombie repeat firing
    await this.queue.obliterate({ force: true }).catch((err) =>
      this.logger.warn(`could not reset queue: ${(err as Error).message}`),
    );
    this.worker = new Worker(
      QUEUE,
      async () => {
        this.logger.log('scheduled refresh — pulling live monitors');
        await runIngest();
      },
      { connection, concurrency: 1 },
    );
    this.worker.on('completed', () => this.logger.log('scheduled refresh complete'));
    this.worker.on('failed', (_job, err) =>
      this.logger.warn(`scheduled refresh failed (keeping last data): ${err?.message}`),
    );

    await this.queue.add(JOB, {}, { repeat: { every: EVERY_MS }, removeOnComplete: true, removeOnFail: 20 });
    this.logger.log(`monitor refresh scheduled every ${Math.round(EVERY_MS / 60000)} min`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
