import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { runSeed } from './seed/seed';
import { runReferenceRefresh } from './ingest/reference';
import { runIngest } from './ingest/ingest';

async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');

  if (process.env.SEED_ON_START === 'true') {
    logger.log('SEED_ON_START=true — seeding schema + country polygons');
    await runSeed();
  }

  // live reference data (World Bank population, State of Global Air GBD deaths/DALYs); on failure we keep prior data
  if (process.env.REFERENCE_ON_START === 'true') {
    logger.log('REFERENCE_ON_START=true — pulling reference data (population, deaths, DALYs)');
    try {
      await runReferenceRefresh();
    } catch (err) {
      logger.warn(`reference refresh failed, serving prior data: ${(err as Error).message}`);
    }
  }

  // live monitors from the AirGradient Map API; if it's unreachable we keep the seeded data
  if (process.env.INGEST_ON_START === 'true') {
    logger.log('INGEST_ON_START=true — pulling live monitors');
    try {
      await runIngest();
    } catch (err) {
      logger.warn(`live ingest failed, serving seeded data: ${(err as Error).message}`);
    }
  }

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? '*' });

  const config = new DocumentBuilder()
    .setTitle('Open Air Monitoring Gap API')
    .setDescription('Monitors × health burden — the monitoring gap, as data.')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/v1/docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  logger.log(`API on http://localhost:${port}/api/v1  (docs: /api/v1/docs)`);
}

bootstrap();
