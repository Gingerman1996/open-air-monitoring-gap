import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Injectable()
export class HealthImpactsService {
  constructor(private readonly db: DbService) {}

  /** With a year → that year's row. Without → the full yearly series (for the trend sparkline). */
  async forCountry(country: string, year?: number) {
    if (year) {
      const rows = await this.db.query(
        `SELECT country_name AS country, year, pollutant, deaths, deaths_per_100k::float AS deaths_per_100k, dalys
         FROM health_impacts WHERE country_name = $1 AND year = $2 AND pollutant = 'pm25'`,
        [country, year],
      );
      return rows[0] ?? null;
    }
    return this.db.query(
      `SELECT year, deaths, deaths_per_100k::float AS deaths_per_100k
       FROM health_impacts WHERE country_name = $1 AND pollutant = 'pm25' ORDER BY year`,
      [country],
    );
  }

  async compare(countries: string[]) {
    return this.db.query(
      `SELECT DISTINCT ON (country_name) country_name AS country, year, deaths,
              deaths_per_100k::float AS deaths_per_100k
       FROM health_impacts WHERE country_name = ANY($1) AND pollutant = 'pm25'
       ORDER BY country_name, year DESC`,
      [countries],
    );
  }
}
