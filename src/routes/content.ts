import { Router, Request, Response, NextFunction } from 'express';
import { browserPool } from '../services/browserPool.js';
import { ValidationError } from '../middleware/errorHandler.js';
import { getServerConfig } from '../utils/config.js';
import logger from '../utils/logger.js';
import type { ContentRequest, BrowserType, GotoOptions, ViewportOptions } from '../types/index.js';
import { normalizeWaitUntil } from '../utils/normalizeWaitUntil.js';

const router = Router();

/**
 * POST /content
 *
 * Get the full HTML content of a page after JavaScript execution.
 *
 * Request body:
 * - url: URL to navigate to
 * - timeout: timeout in milliseconds
 * - browserType: 'chromium' or 'firefox'
 * - gotoOptions: navigation options
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const config = getServerConfig();
  const body = req.body as ContentRequest;

  if (!body.url) {
    return next(new ValidationError('url is required'));
  }

  const browserType: BrowserType = body.browserType || 'chromium';
  const timeout = body.timeout || config.defaultTimeout;
  const gotoOptions: GotoOptions = body.gotoOptions || { waitUntil: 'networkidle' };
  const viewport = body.viewport;

  logger.info({ browserType, url: body.url }, 'Content requested');

  let resource = null;
  try {
    resource = await browserPool.acquire(browserType, timeout, viewport);
    const { page, release } = resource;

    page.setDefaultTimeout(timeout);

    await page.goto(body.url, {
      waitUntil: normalizeWaitUntil(gotoOptions.waitUntil) || 'networkidle',
      timeout: gotoOptions.timeout || timeout,
      referer: gotoOptions.referer,
    });

    const content = await page.content();

    await release();

    res.set('Content-Type', 'text/html');
    res.send(content);
  } catch (error) {
    if (resource) {
      try {
        await resource.release();
      } catch (releaseError) {
        logger.warn({ releaseError }, 'Error releasing resource after content error');
      }
    }
    next(error);
  }
});

/**
 * GET /content
 *
 * Get the full HTML content of a page.
 *
 * Query params:
 * - url: URL to get content from
 * - browserType: 'chromium' or 'firefox'
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const config = getServerConfig();

  const url = req.query.url as string;
  if (!url) {
    return next(new ValidationError('url query parameter is required'));
  }

  const browserType = (req.query.browserType as BrowserType) || 'chromium';
  const timeout = parseInt(req.query.timeout as string, 10) || config.defaultTimeout;
  const viewport: ViewportOptions | undefined = req.query.width || req.query.height
    ? {
        width: req.query.width ? parseInt(req.query.width as string, 10) : undefined,
        height: req.query.height ? parseInt(req.query.height as string, 10) : undefined,
      }
    : undefined;

  logger.info({ browserType, url }, 'Content requested (GET)');

  let resource = null;
  try {
    resource = await browserPool.acquire(browserType, timeout, viewport);
    const { page, release } = resource;

    page.setDefaultTimeout(timeout);

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout,
    });

    const content = await page.content();

    await release();

    res.set('Content-Type', 'text/html');
    res.send(content);
  } catch (error) {
    if (resource) {
      try {
        await resource.release();
      } catch (releaseError) {
        logger.warn({ releaseError }, 'Error releasing resource after content error');
      }
    }
    next(error);
  }
});

export default router;
