import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

const DONATIONS_KEY = 'config:donations_enabled';

/** Runtime feature flags, persisted in Redis so an admin can flip them without a redeploy. */
@Injectable()
export class ConfigService {
  constructor(private readonly cache: CacheService) {}

  /** Redis override if set, else the DONATIONS_ENABLED env default (on unless explicitly 'false'). */
  async donationsEnabled(): Promise<boolean> {
    const stored = await this.cache.get(DONATIONS_KEY);
    if (stored === null) return (process.env.DONATIONS_ENABLED ?? 'true') !== 'false';
    return stored === 'true';
  }

  async setDonationsEnabled(enabled: boolean): Promise<void> {
    const ok = await this.cache.set(DONATIONS_KEY, enabled ? 'true' : 'false');
    if (!ok) throw new ServiceUnavailableException('config store (Redis) unavailable');
  }
}
