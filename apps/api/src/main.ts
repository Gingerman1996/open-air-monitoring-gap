import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { runSeed } from './seed/seed';

async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');

  if (process.env.SEED_ON_START === 'true') {
    logger.log('SEED_ON_START=true — seeding database');
    await runSeed();
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
