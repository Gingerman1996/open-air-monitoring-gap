import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DbService } from '../db/db.service';
import { DensityService } from '../density/density.service';

@ApiTags('stats')
@Controller('stats')
export class StatsController {
  constructor(
    private readonly db: DbService,
    private readonly density: DensityService,
  ) {}

  @Get('global')
  @ApiOkResponse({ description: 'Totals for the count pill + the Lv-1 gap threshold.' })
  async global() {
    const [counts] = await this.db.query<{ monitors: number; cities: number; countries: number }>(
      `SELECT
         (SELECT COUNT(*) FROM monitors)::int AS monitors,
         (SELECT COUNT(*) FROM urban_centers)::int AS cities,
         (SELECT COUNT(*) FROM density_stats WHERE scope_type='country' AND gap_level IS NOT NULL)::int AS countries`,
    );
    const [worst] = await this.db.query<{ name: string; gap_ratio: number }>(
      `SELECT scope_name AS name, gap_ratio::float AS gap_ratio
       FROM density_stats
       WHERE scope_type='country' AND gap_level IS NOT NULL
       ORDER BY gap_ratio DESC LIMIT 1`,
    );
    return {
      monitors: counts?.monitors ?? 0,
      cities: counts?.cities ?? 0,
      countries_with_data: counts?.countries ?? 0,
      widest_gap: worst ?? null,
      gap_threshold_lv1: await this.density.gapThresholdLv1(),
    };
  }
}
