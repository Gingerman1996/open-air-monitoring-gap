import { Module } from '@nestjs/common';
import { DensityController } from './density.controller';
import { DensityService } from './density.service';

@Module({
  controllers: [DensityController],
  providers: [DensityService],
  exports: [DensityService],
})
export class DensityModule {}
