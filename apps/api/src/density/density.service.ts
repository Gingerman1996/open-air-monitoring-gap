import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { CacheService } from '../cache/cache.service';

const COUNTRY_STATS = `
  SELECT ds.scope_name AS country, ds.population::float AS population, ds.monitors_total, ds.monitors_online,
         ds.reference, ds.low_cost, ds.monitors_per_100k::float AS monitors_per_100k,
         ds.deaths_per_100k::float AS deaths_per_100k, ds.avg_pm25::float AS avg_pm25,
         ds.gap_ratio::float AS gap_ratio, ds.gap_level,
         hi.deaths::float AS deaths
  FROM density_stats ds
  LEFT JOIN LATERAL (
    SELECT deaths FROM health_impacts h
    WHERE h.country_name = ds.scope_name AND h.pollutant = 'pm25'
    ORDER BY year DESC LIMIT 1
  ) hi ON true
  WHERE ds.scope_type = 'country'`;

@Injectable()
export class DensityService {
  constructor(
    private readonly db: DbService,
    private readonly cache: CacheService,
  ) {}

  async countryStats(name?: string) {
    if (name) {
      const rows = await this.db.query(`${COUNTRY_STATS} AND ds.scope_name = $1`, [name]);
      return rows[0] ?? null;
    }
    return this.db.query(`${COUNTRY_STATS} ORDER BY ds.scope_name`);
  }

  async cityStats() {
    return this.db.query(
      `SELECT scope_name AS city, country_name AS country, population, monitors_total,
              monitors_online, reference, low_cost, monitors_per_100k::float AS monitors_per_100k,
              deaths_per_100k::float AS deaths_per_100k, avg_pm25::float AS avg_pm25,
              gap_ratio::float AS gap_ratio
       FROM density_stats WHERE scope_type = 'city' ORDER BY gap_ratio DESC`,
    );
  }

  async ranking(limit = 20) {
    return this.db.query(
      `${COUNTRY_STATS} AND ds.gap_level IS NOT NULL ORDER BY ds.gap_ratio DESC LIMIT $1`,
      [limit],
    );
  }

  /** Top of quintile-1 — the gap_ratio a country must fall below to be "in the good zone". */
  async gapThresholdLv1(): Promise<number | null> {
    const rows = await this.db.query<{ t: number | null }>(
      `SELECT MAX(gap_ratio)::float AS t FROM density_stats
       WHERE scope_type = 'country' AND gap_level = 1`,
    );
    return rows[0]?.t ?? null;
  }

  async choropleth() {
    return this.cache.wrap('choropleth:v1', 300, async () => {
      const rows = await this.db.query<{
        name: string;
        population: number | null;
        geometry: unknown;
        deaths: number | null;
        deaths_per_100k: number | null;
        monitors_total: number | null;
        gap_ratio: number | null;
        gap_level: number | null;
      }>(
        `SELECT c.name, c.population::float AS population,
                ST_AsGeoJSON(c.geom)::json AS geometry,
                hi.deaths::float AS deaths, hi.deaths_per_100k::float AS deaths_per_100k,
                ds.monitors_total, ds.gap_ratio::float AS gap_ratio, ds.gap_level
         FROM countries c
         LEFT JOIN LATERAL (
           SELECT deaths, deaths_per_100k FROM health_impacts h
           WHERE h.country_name = c.name AND h.pollutant = 'pm25'
           ORDER BY year DESC LIMIT 1
         ) hi ON true
         LEFT JOIN density_stats ds
           ON ds.scope_type = 'country' AND ds.scope_name = c.name
         WHERE c.geom IS NOT NULL`,
      );
      return {
        type: 'FeatureCollection',
        features: rows.map((r) => ({
          type: 'Feature',
          geometry: r.geometry,
          properties: {
            name: r.name,
            population: r.population,
            deaths: r.deaths,
            deaths_per_100k: r.deaths_per_100k,
            monitors_total: r.monitors_total,
            gap_ratio: r.gap_ratio,
            gap_level: r.gap_level,
          },
        })),
      };
    });
  }
}
