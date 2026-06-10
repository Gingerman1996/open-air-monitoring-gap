import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface NewDonation {
  donorName: string;
  country: string | null;
  amount: number;
}

export interface Donation {
  id: number;
  donor_name: string;
  country: string | null;
  amount: number;
  created_at: string;
}

@Injectable()
export class DonationsService {
  constructor(private readonly db: DbService) {}

  async create(d: NewDonation): Promise<Donation> {
    const rows = await this.db.query<Donation>(
      `INSERT INTO donations (donor_name, country, amount)
       VALUES ($1, $2, $3)
       RETURNING id, donor_name, country, amount::float AS amount, created_at`,
      [d.donorName, d.country, d.amount],
    );
    return rows[0];
  }

  /** Leaderboard: total pledged per donor (case-insensitive name merge). */
  async topDonors(limit = 8) {
    return this.db.query<{ donor_name: string; total: number; gifts: number }>(
      `SELECT MIN(donor_name) AS donor_name, SUM(amount)::float AS total, COUNT(*)::int AS gifts
       FROM donations
       GROUP BY lower(donor_name)
       ORDER BY total DESC
       LIMIT $1`,
      [limit],
    );
  }

  /** Total pledged per country — the client folds this into the "fully equip" bar. */
  async raisedByCountry() {
    return this.db.query<{ country: string; raised: number }>(
      `SELECT country, SUM(amount)::float AS raised
       FROM donations
       WHERE country IS NOT NULL
       GROUP BY country`,
    );
  }
}
