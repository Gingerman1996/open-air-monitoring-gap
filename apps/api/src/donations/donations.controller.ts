import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DonationsService } from './donations.service';

interface CreateDonationBody {
  donorName?: unknown;
  country?: unknown;
  amount?: unknown;
}

const MAX_AMOUNT = 1_000_000_000; // sanity ceiling for the demo

@ApiTags('donations')
@Controller('donations')
export class DonationsController {
  constructor(private readonly donations: DonationsService) {}

  @Post()
  @ApiOkResponse({ description: 'Record a (demo) donation pledge.' })
  async create(@Body() body: CreateDonationBody) {
    const donorName = typeof body.donorName === 'string' ? body.donorName.trim() : '';
    if (!donorName) throw new BadRequestException('donorName is required');
    if (donorName.length > 80) throw new BadRequestException('donorName too long');

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      throw new BadRequestException('amount must be a positive number');
    }

    const country =
      typeof body.country === 'string' && body.country.trim() ? body.country.trim().slice(0, 80) : null;

    return this.donations.create({ donorName, country, amount });
  }

  @Get('top')
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ description: 'Top supporters by total pledged.' })
  top(@Query('limit') limit?: string) {
    return this.donations.topDonors(limit ? Math.min(50, Math.max(1, Number(limit) || 8)) : 8);
  }

  @Get('raised')
  @ApiOkResponse({ description: 'Total pledged per country.' })
  raised() {
    return this.donations.raisedByCountry();
  }
}
