/**
 * Test preload: provides deterministic environment variables so that
 * `bun test` runs without a local .env file (reproducible CI).
 */

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://flashsale:flashsale@localhost:5432/flashsale_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RABBITMQ_URL ??= 'amqp://guest:guest@localhost:5672';
process.env.JWT_SECRET ??= 'test-secret-do-not-use-in-prod';
