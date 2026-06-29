/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';
import { type LogLevel } from 'scripts/conf/config';

/**
 * Structured logger used throughout the application.
 */
export type Logger = PinoLogger;

/**
 * Builds pino options for `level`. In development it pretty-prints; in production it emits
 * one JSON object per line to stdout (no files inside the container). Shared between the
 * standalone app logger and Fastify's request logger so output formatting stays consistent.
 */
export function loggerOptions(level: LogLevel): LoggerOptions {
  const pretty = process.env.NODE_ENV !== 'production';
  return {
    level,
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } }
      : {}),
  };
}

/**
 * Builds the standalone root logger (used by migrations, webhook handlers, and retention).
 */
export function createLogger(level: LogLevel): Logger {
  return pino(loggerOptions(level));
}
