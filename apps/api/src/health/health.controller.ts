import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DbService } from '../db/db.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get()
  async check() {
    let db = 'down';
    try {
      await this.db.query('SELECT 1');
      db = 'up';
    } catch {
      db = 'down';
    }
    return { status: 'ok', db, ts: new Date().toISOString() };
  }
}
