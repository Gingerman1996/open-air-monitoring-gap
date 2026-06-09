import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DensityService } from './density.service';

@ApiTags('density')
@Controller('density')
export class DensityController {
  constructor(private readonly density: DensityService) {}

  @Get()
  @ApiQuery({ name: 'country', required: false, description: 'world-atlas country name' })
  @ApiOkResponse({ description: 'Pre-aggregated density stats per country.' })
  byCountry(@Query('country') country?: string) {
    return this.density.countryStats(country);
  }

  @Get('choropleth')
  @ApiOkResponse({ description: 'GeoJSON FeatureCollection: country geom + deaths + gap.' })
  choropleth() {
    return this.density.choropleth();
  }

  @Get('ranking')
  @ApiQuery({ name: 'limit', required: false })
  ranking(@Query('limit') limit?: string) {
    return this.density.ranking(limit ? Math.min(200, Math.max(1, Number(limit) || 20)) : 20);
  }
}
