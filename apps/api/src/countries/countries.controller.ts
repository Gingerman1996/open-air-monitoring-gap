import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DbService } from '../db/db.service';

@ApiTags('countries')
@Controller('countries')
export class CountriesController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOkResponse({ description: 'Countries with latest deaths + population.' })
  findAll() {
    return this.db.query(
      `SELECT c.name, c.name_th, c.population::float AS population,
              hi.deaths::float AS deaths, hi.deaths_per_100k::float AS deaths_per_100k
       FROM countries c
       LEFT JOIN LATERAL (
         SELECT deaths, deaths_per_100k FROM health_impacts h
         WHERE h.country_name = c.name AND h.pollutant = 'pm25'
         ORDER BY year DESC LIMIT 1
       ) hi ON true
       ORDER BY c.name`,
    );
  }
}
