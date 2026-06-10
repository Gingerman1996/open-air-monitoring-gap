import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface MonitorFilters {
  bbox?: string; // "minLng,minLat,maxLng,maxLat"
  type?: string[];
  status?: string[];
  manufacturer?: string[];
}

const SELECT = `
  SELECT external_id AS id, name, city, country, iso2, manufacturer, type, owner,
         status, pm25::float AS pm25, aqi,
         round(ST_Y(location)::numeric, 5)::float AS lat,
         round(ST_X(location)::numeric, 5)::float AS lng
  FROM monitors`;

@Injectable()
export class MonitorsService {
  constructor(private readonly db: DbService) {}

  async findAll(f: MonitorFilters = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.bbox) {
      const b = f.bbox.split(',').map(Number);
      if (b.length === 4 && b.every((n) => Number.isFinite(n))) {
        params.push(b[0], b[1], b[2], b[3]);
        where.push(
          `location && ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`,
        );
      }
    }
    if (f.type?.length) {
      params.push(f.type);
      where.push(`type = ANY($${params.length})`);
    }
    if (f.status?.length) {
      params.push(f.status);
      where.push(`status = ANY($${params.length})`);
    }
    if (f.manufacturer?.length) {
      params.push(f.manufacturer);
      where.push(`manufacturer = ANY($${params.length})`);
    }
    const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY external_id`;
    return this.db.query(sql, params);
  }

  async findOne(id: string) {
    const rows = await this.db.query(`${SELECT} WHERE external_id = $1`, [id]);
    return rows[0] ?? null;
  }

  async measurements(id: string) {
    return this.db.query(
      `SELECT m.ts, m.pm25::float AS pm25, m.aqi
       FROM measurements m JOIN monitors mo ON mo.id = m.monitor_id
       WHERE mo.external_id = $1 ORDER BY m.ts DESC LIMIT 168`,
      [id],
    );
  }
}
