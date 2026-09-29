/**
 * Minimal structured logger (JSON lines).
 * Zero-dependency; keeps log output machine-parseable for observability.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

interface LogFields {
  [key: string]: unknown;
}

function write(level: Level, message: string, fields?: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    console.error(line);
    return;
  }
  console.log(line);
}

export const logger = {
  debug: (message: string, fields?: LogFields): void => write('debug', message, fields),
  info: (message: string, fields?: LogFields): void => write('info', message, fields),
  warn: (message: string, fields?: LogFields): void => write('warn', message, fields),
  error: (message: string, fields?: LogFields): void => write('error', message, fields),
};
