import { Router, Request, Response } from 'express';
import { browserPool } from '../services/browserPool.js';
import { getServerConfig } from '../utils/config.js';
import type { HealthStatus } from '../types/index.js';

const router = Router();
const startTime = Date.now();
const version = process.env.npm_package_version || '1.0.0';

/**
 * GET /health
 *
 * Health check endpoint for container orchestration.
 */
router.get('/', (_req: Request, res: Response) => {
  const config = getServerConfig();
  const stats = browserPool.getStats();

  const status: HealthStatus = {
    status: 'ok',
    browsers: {
      chromium: {
        enabled: config.enableChromium,
        available: stats.chromium.available,
        inUse: stats.chromium.inUse,
        total: stats.chromium.total,
      },
      firefox: {
        enabled: config.enableFirefox,
        available: stats.firefox.available,
        inUse: stats.firefox.inUse,
        total: stats.firefox.total,
      },
    },
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version,
  };

  // Determine overall status
  if (
    (config.enableChromium && stats.chromium.total === 0) &&
    (config.enableFirefox && stats.firefox.total === 0)
  ) {
    status.status = 'error';
  } else if (stats.queueLength > 5) {
    status.status = 'degraded';
  }

  const httpStatus = status.status === 'error' ? 503 : 200;
  res.status(httpStatus).json(status);
});

/**
 * GET /health/ready
 *
 * Readiness probe - returns 200 when ready to accept traffic.
 */
router.get('/ready', (_req: Request, res: Response) => {
  const config = getServerConfig();
  const stats = browserPool.getStats();

  const hasChromium = !config.enableChromium || stats.chromium.total > 0;
  const hasFirefox = !config.enableFirefox || stats.firefox.total > 0;

  if (hasChromium && hasFirefox) {
    res.status(200).json({ ready: true });
  } else {
    res.status(503).json({
      ready: false,
      chromium: hasChromium,
      firefox: hasFirefox,
    });
  }
});

/**
 * GET /health/live
 *
 * Liveness probe - returns 200 if the service is alive.
 */
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ alive: true });
});

/**
 * GET /metrics
 *
 * Prometheus-compatible metrics endpoint.
 */
router.get('/metrics', (_req: Request, res: Response) => {
  const config = getServerConfig();
  const stats = browserPool.getStats();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  const metrics = `
# HELP browserful_uptime_seconds Time since service started
# TYPE browserful_uptime_seconds gauge
browserful_uptime_seconds ${uptimeSeconds}

# HELP browserful_chromium_browsers_total Total Chromium browser instances
# TYPE browserful_chromium_browsers_total gauge
browserful_chromium_browsers_total ${stats.chromium.total}

# HELP browserful_chromium_browsers_in_use Chromium browsers currently in use
# TYPE browserful_chromium_browsers_in_use gauge
browserful_chromium_browsers_in_use ${stats.chromium.inUse}

# HELP browserful_chromium_browsers_available Available Chromium browsers
# TYPE browserful_chromium_browsers_available gauge
browserful_chromium_browsers_available ${stats.chromium.available}

# HELP browserful_firefox_browsers_total Total Firefox browser instances
# TYPE browserful_firefox_browsers_total gauge
browserful_firefox_browsers_total ${stats.firefox.total}

# HELP browserful_firefox_browsers_in_use Firefox browsers currently in use
# TYPE browserful_firefox_browsers_in_use gauge
browserful_firefox_browsers_in_use ${stats.firefox.inUse}

# HELP browserful_firefox_browsers_available Available Firefox browsers
# TYPE browserful_firefox_browsers_available gauge
browserful_firefox_browsers_available ${stats.firefox.available}

# HELP browserful_queue_length Number of requests waiting for a browser
# TYPE browserful_queue_length gauge
browserful_queue_length ${stats.queueLength}

# HELP browserful_chromium_enabled Whether Chromium is enabled
# TYPE browserful_chromium_enabled gauge
browserful_chromium_enabled ${config.enableChromium ? 1 : 0}

# HELP browserful_firefox_enabled Whether Firefox is enabled
# TYPE browserful_firefox_enabled gauge
browserful_firefox_enabled ${config.enableFirefox ? 1 : 0}
`.trim();

  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(metrics);
});

export default router;
