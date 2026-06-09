import { Module } from '@nestjs/common';
import { MonitorsModule } from '../monitors/monitors.module';
import { ExportController } from './export.controller';

@Module({
  imports: [MonitorsModule],
  controllers: [ExportController],
})
export class ExportModule {}
