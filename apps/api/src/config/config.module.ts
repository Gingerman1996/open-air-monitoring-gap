import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { AdminGuard } from './admin.guard';
import { DonationsEnabledGuard } from './donations-enabled.guard';

@Module({
  controllers: [ConfigController],
  providers: [ConfigService, AdminGuard, DonationsEnabledGuard],
  exports: [ConfigService, DonationsEnabledGuard],
})
export class ConfigModule {}
