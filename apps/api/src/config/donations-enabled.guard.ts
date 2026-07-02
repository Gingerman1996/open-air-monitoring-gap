import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from './config.service';

/** Makes the donation endpoints behave as if absent (404) when the feature is switched off. */
@Injectable()
export class DonationsEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    if (!(await this.config.donationsEnabled())) throw new NotFoundException();
    return true;
  }
}
