import { Logger } from '@nestjs/common';

const logger = new Logger('Env');
const warned = new Set<string>();

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function requireEnv(name: string): string {
  const value = read(name);
  if (value) return value;
  const message = `Missing required environment variable: ${name}`;
  logger.error(message);
  throw new Error(message);
}

export function getWebOrigins(): string[] {
  const raw = read('WEB_ORIGIN');
  if (!raw) {
    const key = 'WEB_ORIGIN';
    if (!warned.has(key)) {
      warned.add(key);
      logger.error('Missing WEB_ORIGIN. Falling back to http://localhost:3000');
    }
    return ['http://localhost:3000'];
  }

  const origins = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (origins.length > 0) return origins;

  const key = 'WEB_ORIGIN_EMPTY';
  if (!warned.has(key)) {
    warned.add(key);
    logger.error('WEB_ORIGIN is empty after parsing. Falling back to http://localhost:3000');
  }
  return ['http://localhost:3000'];
}

