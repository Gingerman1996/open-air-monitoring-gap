import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MonitorsService } from './monitors.service';

const list = (v?: string): string[] | undefined =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

@ApiTags('monitors')
@Controller('monitors')
export class MonitorsController {
  constructor(private readonly monitors: MonitorsService) {}

  @Get()
  @ApiQuery({ name: 'bbox', required: false, description: 'minLng,minLat,maxLng,maxLat' })
  @ApiQuery({ name: 'type', required: false, description: 'low_cost,reference' })
  @ApiQuery({ name: 'status', required: false, description: 'online,offline' })
  @ApiQuery({ name: 'manufacturer', required: false })
  @ApiOkResponse({ description: 'Public air-quality monitors (filtered).' })
  findAll(
    @Query('bbox') bbox?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('manufacturer') manufacturer?: string,
  ) {
    return this.monitors.findAll({
      bbox,
      type: list(type),
      status: list(status),
      manufacturer: list(manufacturer),
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const m = await this.monitors.findOne(id);
    if (!m) throw new NotFoundException(`monitor ${id} not found`);
    return m;
  }

  @Get(':id/measurements')
  measurements(@Param('id') id: string) {
    return this.monitors.measurements(id);
  }
}
