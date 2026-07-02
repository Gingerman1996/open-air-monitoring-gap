import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ConfigService } from './config.service';
import { AdminGuard } from './admin.guard';

interface SetDonationsBody {
  enabled?: unknown;
}

@ApiTags('config')
@Controller('config')
export class ConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @ApiOkResponse({ description: 'Public runtime feature flags (e.g. donationsEnabled).' })
  async get() {
    return { donationsEnabled: await this.config.donationsEnabled() };
  }

  @Post('donations')
  @UseGuards(AdminGuard)
  @ApiSecurity('admin-token')
  @ApiOkResponse({ description: 'Enable/disable the donation feature at runtime (admin only).' })
  async setDonations(@Body() body: SetDonationsBody) {
    if (typeof body.enabled !== 'boolean') throw new BadRequestException('enabled must be a boolean');
    await this.config.setDonationsEnabled(body.enabled);
    return { donationsEnabled: body.enabled };
  }
}
