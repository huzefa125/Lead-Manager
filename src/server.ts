import type { Server } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectDatabase, disconnectDatabase } from './config/prisma';

async function bootstrap(): Promise<void> {
  // Fail fast: a process that cannot reach its database should not accept
  // traffic and report itself healthy.
  await connectDatabase();

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      `Auth service listening on http://localhost:${env.PORT}`,
    );
  });

  registerShutdownHandlers(server);
}

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests
 * finish, then close the database pool. The timer is the backstop for a
 * connection that refuses to drain.
 */
function registerShutdownHandlers(server: Server): void {
  const SHUTDOWN_TIMEOUT_MS = 10_000;
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Shutdown signal received — draining connections');

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await disconnectDatabase();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // An unhandled rejection or uncaught exception leaves the process in an
  // unknown state. Log it, then let the supervisor restart us cleanly.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    void shutdown('uncaughtException');
  });
}

bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start the server');
  process.exit(1);
});
