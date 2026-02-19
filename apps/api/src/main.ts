import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { CustomIoAdapter } from './custom-io.adapter';
import { getWebOrigins } from './config/env';

const httpLogger = new Logger('HTTP');

async function bootstrap() {
  if (!process.env['LLM_API_KEY'] && process.env['OPENAI_API_KEY']) {
    process.env['LLM_API_KEY'] = process.env['OPENAI_API_KEY'];
  }
  if (!process.env['STT_API_KEY'] && process.env['DEEPGRAM_API_KEY']) {
    process.env['STT_API_KEY'] = process.env['DEEPGRAM_API_KEY'];
  }
  if (!process.env['TWILIO_WEBHOOK_BASE_URL'] && process.env['API_BASE_URL']) {
    process.env['TWILIO_WEBHOOK_BASE_URL'] = process.env['API_BASE_URL'];
  }

  const app = await NestFactory.create(AppModule);

  app.useWebSocketAdapter(new CustomIoAdapter(app));
  app.use(cookieParser());

  // Log every incoming HTTP request — critical for seeing if Twilio webhooks arrive
  app.use((req: Request, _res: Response, next: NextFunction) => {
    httpLogger.log(`${req.method} ${req.url}`);
    next();
  });
  // Twilio status webhooks send application/x-www-form-urlencoded
  app.use(express.urlencoded({ extended: false }));

  app.enableCors({
    origin: getWebOrigins(),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = process.env['PORT'] ?? 3001;
  await app.listen(port, '0.0.0.0');

  console.log(`\n🚀  API running on http://localhost:${port}`);
  console.log(`❤️   Health → http://localhost:${port}/health\n`);
}

bootstrap();
