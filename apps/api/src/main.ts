import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { IoAdapter } from '@nestjs/platform-socket.io';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';

const httpLogger = new Logger('HTTP');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useWebSocketAdapter(new IoAdapter(app));
  app.use(cookieParser());

  // Log every incoming HTTP request — critical for seeing if Twilio webhooks arrive
  app.use((req: Request, _res: Response, next: NextFunction) => {
    httpLogger.log(`${req.method} ${req.url}`);
    next();
  });
  // Twilio status webhooks send application/x-www-form-urlencoded
  app.use(express.urlencoded({ extended: false }));

  app.enableCors({
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = process.env['PORT'] ?? 3001;
  await app.listen(port);

  console.log(`\n🚀  API running on http://localhost:${port}`);
  console.log(`❤️   Health → http://localhost:${port}/health\n`);
}

bootstrap();
