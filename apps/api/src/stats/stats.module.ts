import { Module } from '@nestjs/common';
import { DensityModule } from '../density/density.module';
import { StatsController } from './stats.controller';

@Module({
  imports: [DensityModule],
  controllers: [StatsController],
})
export class StatsModule {}
