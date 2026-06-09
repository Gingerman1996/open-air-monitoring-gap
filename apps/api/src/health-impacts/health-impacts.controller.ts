import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { HealthImpactsService } from './health-impacts.service';

@ApiTags('health-impacts')
@Controller('health-impacts')
export class HealthImpactsController {
  constructor(private readonly health: HealthImpactsService) {}

  @Get()
  @ApiQuery({ name: 'country', required: true, description: 'world-atlas country name' })
  @ApiQuery({ name: 'year', required: false, description: 'omit for the 1990–2023 series' })
  @ApiOkResponse({ description: 'Deaths/DALYs; without `year` returns the yearly series.' })
  forCountry(@Query('country') country: string, @Query('year') year?: string) {
    return this.health.forCountry(country, year ? Number(year) : undefined);
  }

  @Get('compare')
  @ApiQuery({ name: 'country', required: true, description: 'comma-separated country names' })
  compare(@Query('country') country: string) {
    const names = country.split(',').map((s) => s.trim()).filter(Boolean);
    return this.health.compare(names);
  }
}
