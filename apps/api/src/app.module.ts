import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { CacheModule } from './cache/cache.module';
import { HealthModule } from './health/health.module';
import { MonitorsModule } from './monitors/monitors.module';
import { CountriesModule } from './countries/countries.module';
import { DensityModule } from './density/density.module';
import { HealthImpactsModule } from './health-impacts/health-impacts.module';
import { StatsModule } from './stats/stats.module';
import { ExportModule } from './export/export.module';
import { IngestScheduler } from './ingest/ingest.scheduler';

@Module({
  imports: [
    DbModule,
    CacheModule,
    HealthModule,
    MonitorsModule,
    CountriesModule,
    DensityModule,
    HealthImpactsModule,
    StatsModule,
    ExportModule,
  ],
  providers: [IngestScheduler],
})
export class AppModule {}
