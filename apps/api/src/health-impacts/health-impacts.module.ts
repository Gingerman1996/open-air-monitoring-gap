import { Module } from '@nestjs/common';
import { HealthImpactsController } from './health-impacts.controller';
import { HealthImpactsService } from './health-impacts.service';

@Module({
  controllers: [HealthImpactsController],
  providers: [HealthImpactsService],
  exports: [HealthImpactsService],
})
export class HealthImpactsModule {}
