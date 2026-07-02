import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Thin Redis wrapper with a read-through helper. If Redis is unreachable the
 * loader still runs — caching is an optimisation, not a correctness boundary —
 * but the failure is logged, never swallowed silently.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  private connected = false;

  constructor() {
    this.redis.connect().then(
      () => {
        this.connected = true;
      },
      (err) => this.logger.warn(`Redis unavailable, serving uncached: ${err.message}`),
    );
    this.redis.on('error', () => {
      this.connected = false;
    });
  }

  async wrap<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    if (this.connected) {
      try {
        const hit = await this.redis.get(key);
        if (hit) return JSON.parse(hit) as T;
      } catch (err) {
        this.logger.warn(`cache read failed for ${key}: ${(err as Error).message}`);
      }
    }
    const value = await loader();
    if (this.connected) {
      this.redis
        .set(key, JSON.stringify(value), 'EX', ttlSeconds)
        .catch((err) => this.logger.warn(`cache write failed for ${key}: ${err.message}`));
    }
    return value;
  }

  /** Persistent read of a raw string; null if missing or Redis is down. */
  async get(key: string): Promise<string | null> {
    if (!this.connected) return null;
    try {
      return await this.redis.get(key);
    } catch (err) {
      this.logger.warn(`get failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Persistent write (no expiry). Returns false if Redis is down so callers can surface it. */
  async set(key: string, value: string): Promise<boolean> {
    if (!this.connected) return false;
    try {
      await this.redis.set(key, value);
      return true;
    } catch (err) {
      this.logger.warn(`set failed for ${key}: ${(err as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
