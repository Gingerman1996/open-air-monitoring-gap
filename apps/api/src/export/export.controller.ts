import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DbService } from '../db/db.service';
import { MonitorsService } from '../monitors/monitors.service';
import { toCsv } from '../common/csv';

type Cell = string | number | null;
const DATASETS = ['gap', 'monitors', 'density', 'health'] as const;
type Dataset = (typeof DATASETS)[number];

@ApiTags('export')
@Controller('export')
export class ExportController {
  constructor(
    private readonly db: DbService,
    private readonly monitors: MonitorsService,
  ) {}

  @Get()
  @ApiQuery({ name: 'dataset', enum: DATASETS })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'manufacturer', required: false })
  @ApiOkResponse({ description: 'Streamed CSV (UTF-8 + BOM).' })
  async export(
    @Res() res: Response,
    @Query('dataset') dataset?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('manufacturer') manufacturer?: string,
  ) {
    if (!dataset || !DATASETS.includes(dataset as Dataset)) {
      throw new BadRequestException(`dataset must be one of ${DATASETS.join(', ')}`);
    }
    const rows = await this.build(dataset as Dataset, { type, status, manufacturer });
    const csv = toCsv(rows);
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="aq-${dataset}_2026.csv"`)
      .send(csv);
  }

  private list(v?: string) {
    return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  }

  private async build(
    dataset: Dataset,
    f: { type?: string; status?: string; manufacturer?: string },
  ): Promise<Cell[][]> {
    if (dataset === 'monitors') {
      const head = [
        'monitor_id', 'city', 'country', 'manufacturer', 'type', 'owner',
        'lat', 'lng', 'status', 'pm25', 'aqi',
      ];
      const rows = (await this.monitors.findAll({
        type: this.list(f.type),
        status: this.list(f.status),
        manufacturer: this.list(f.manufacturer),
      })) as Array<Record<string, Cell>>;
      return [head, ...rows.map((m) => [
        m.id, m.city, m.country, m.manufacturer, m.type, m.owner,
        m.lat, m.lng, m.status, m.pm25, m.aqi,
      ])];
    }
    if (dataset === 'gap') {
      const head = [
        'city', 'country', 'population', 'monitors_total', 'monitors_online',
        'monitors_per_100k', 'deaths_per_100k', 'avg_pm25', 'gap_ratio',
      ];
      const rows = await this.db.query<Record<string, Cell>>(
        `SELECT scope_name AS city, country_name AS country, population, monitors_total,
                monitors_online, monitors_per_100k, deaths_per_100k, avg_pm25, gap_ratio
         FROM density_stats WHERE scope_type='city' ORDER BY gap_ratio DESC`,
      );
      return [head, ...rows.map((c) => head.map((k) => c[k] ?? null))];
    }
    if (dataset === 'density') {
      const head = [
        'scope_type', 'scope_name', 'country', 'population', 'monitors_total',
        'monitors_online', 'reference', 'low_cost', 'per_100k',
      ];
      const rows = await this.db.query<Record<string, Cell>>(
        `SELECT 'city' AS scope_type, scope_name, country_name AS country, population,
                monitors_total, monitors_online, reference, low_cost,
                monitors_per_100k AS per_100k
         FROM density_stats WHERE scope_type='city' ORDER BY scope_name`,
      );
      return [head, ...rows.map((c) => head.map((k) => c[k] ?? null))];
    }
    // health
    const head = ['city', 'country', 'year', 'pollutant', 'metric', 'value', 'rate_per_100k'];
    const rows = await this.db.query<Record<string, Cell>>(
      `SELECT name AS city, country_name AS country,
              ROUND(deaths_per_100k * population / 100000)::bigint AS value,
              deaths_per_100k
       FROM urban_centers ORDER BY name`,
    );
    return [head, ...rows.map((c) => [
      c.city, c.country, 2026, 'pm25', 'deaths', c.value, c.deaths_per_100k,
    ])];
  }
}
