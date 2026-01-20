import express from 'express';
import { getServerConfig } from './utils/config.js';
import logger from './utils/logger.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { browserPool } from './services/browserPool.js';

// Routes
import functionRouter from './routes/function.js';
import pdfRouter from './routes/pdf.js';
import screenshotRouter from './routes/screenshot.js';
import scrapeRouter from './routes/scrape.js';
import contentRouter from './routes/content.js';
import healthRouter from './routes/health.js';

const config = getServerConfig();
const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
    });
  });
  next();
});

// Health endpoints (no auth required)
app.use('/health', healthRouter);
app.get('/metrics', healthRouter);

// Root endpoint (no auth required)
app.get('/', (_req, res) => {
  res.json({
    name: 'Browserful',
    version: process.env.npm_package_version || '1.0.0',
    description: 'Lightweight headless browser service',
    endpoints: {
      '/function': 'Execute JavaScript code in browser context',
      '/pdf': 'Generate PDF from URL, HTML, or code',
      '/screenshot': 'Take screenshots',
      '/scrape': 'Scrape elements from pages',
      '/content': 'Get rendered HTML content',
      '/health': 'Health check',
      '/metrics': 'Prometheus metrics',
    },
    documentation: 'https://github.com/browserful/browserful',
  });
});

// Protected routes
app.use('/function', authMiddleware, functionRouter);
app.use('/pdf', authMiddleware, pdfRouter);
app.use('/screenshot', authMiddleware, screenshotRouter);
app.use('/scrape', authMiddleware, scrapeRouter);
app.use('/content', authMiddleware, contentRouter);

// Error handler
app.use(errorHandler);

// Graceful shutdown
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, 'Received shutdown signal');

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    // Shutdown browser pool
    await browserPool.shutdown();

    logger.info('Shutdown complete');
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
const server = app.listen(config.port, config.host, async () => {
  logger.info(`Browserful starting on ${config.host}:${config.port}`);
  logger.info({
    chromium: config.enableChromium,
    firefox: config.enableFirefox,
    authEnabled: !!config.token,
  }, 'Configuration');

  // Initialize browser pool
  await browserPool.initialize();

  logger.info(`Browserful ready at http://${config.host}:${config.port}`);
});
