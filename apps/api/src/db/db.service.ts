import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://openair:openair@localhost:5432/openair',
    max: 10,
  });

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const res = await this.pool.query<T>(text, params as never[]);
    return res.rows;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
