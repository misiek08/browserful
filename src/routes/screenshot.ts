import { Router, Request, Response, NextFunction } from 'express';
import { browserPool } from '../services/browserPool.js';
import { ValidationError } from '../middleware/errorHandler.js';
import { getServerConfig } from '../utils/config.js';
import logger from '../utils/logger.js';
import type { ScreenshotRequest, BrowserType, ScreenshotOptions, GotoOptions } from '../types/index.js';

const router = Router();

/**
 * POST /screenshot
 *
 * Take a screenshot from a URL, HTML content, or by executing custom code.
 *
 * Request body:
 * - url: URL to navigate to
 * - html: HTML content to render
 * - code: JavaScript code to execute before screenshot
 * - options: Screenshot options
 * - timeout: timeout in milliseconds
 * - browserType: 'chromium' or 'firefox'
 * - gotoOptions: navigation options
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const config = getServerConfig();
  const body = req.body as ScreenshotRequest;

  // Validate request - must have url, html, or code
  if (!body.url && !body.html && !body.code) {
    return next(new ValidationError('One of url, html, or code is required'));
  }

  const browserType: BrowserType = body.browserType || 'chromium';
  const timeout = body.timeout || config.defaultTimeout;
  const screenshotOptions = body.options || {};
  const gotoOptions: GotoOptions = body.gotoOptions || { waitUntil: 'networkidle' };

  logger.info(
    { browserType, hasUrl: !!body.url, hasHtml: !!body.html, hasCode: !!body.code },
    'Screenshot requested'
  );

  let resource = null;
  try {
    resource = await browserPool.acquire(browserType, timeout);
    const { page, context, release } = resource;

    page.setDefaultTimeout(timeout);

    // Navigate to URL or set HTML content
    if (body.url) {
      await page.goto(body.url, {
        waitUntil: gotoOptions.waitUntil || 'networkidle',
        timeout: gotoOptions.timeout || timeout,
        referer: gotoOptions.referer,
      });
    } else if (body.html) {
      await page.setContent(body.html, {
        waitUntil: gotoOptions.waitUntil || 'networkidle',
        timeout: gotoOptions.timeout || timeout,
      });
    }

    // Execute custom code if provided
    if (body.code) {
      const wrappedCode = `
        return (async () => {
          ${body.code}
        })();
      `;

      const fn = new Function('page', 'context', wrappedCode);
      await fn(page, context);
    }

    // Take screenshot
    const playwrightOptions: Parameters<typeof page.screenshot>[0] = {
      type: screenshotOptions.type || 'png',
      fullPage: screenshotOptions.fullPage ?? false,
      omitBackground: screenshotOptions.omitBackground ?? false,
    };

    if (screenshotOptions.type === 'jpeg' && screenshotOptions.quality) {
      playwrightOptions.quality = screenshotOptions.quality;
    }

    if (screenshotOptions.clip) {
      playwrightOptions.clip = screenshotOptions.clip;
    }

    const screenshot = await page.screenshot(playwrightOptions);

    await release();

    // Return based on encoding option
    if (screenshotOptions.encoding === 'base64') {
      res.json({
        data: screenshot.toString('base64'),
        type: screenshotOptions.type || 'png',
      });
    } else {
      const contentType = screenshotOptions.type === 'jpeg' ? 'image/jpeg' : 'image/png';
      res.set('Content-Type', contentType);
      res.send(screenshot);
    }
  } catch (error) {
    if (resource) {
      try {
        await resource.release();
      } catch (releaseError) {
        logger.warn({ releaseError }, 'Error releasing resource after screenshot error');
      }
    }
    next(error);
  }
});

/**
 * GET /screenshot
 *
 * Take a screenshot from a URL passed as query parameter.
 *
 * Query params:
 * - url: URL to screenshot
 * - browserType: 'chromium' or 'firefox'
 * - type: 'png' or 'jpeg'
 * - fullPage: true/false
 * - quality: JPEG quality (1-100)
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const config = getServerConfig();

  const url = req.query.url as string;
  if (!url) {
    return next(new ValidationError('url query parameter is required'));
  }

  const browserType = (req.query.browserType as BrowserType) || 'chromium';
  const timeout = parseInt(req.query.timeout as string, 10) || config.defaultTimeout;

  const screenshotOptions: ScreenshotOptions = {
    type: (req.query.type as 'png' | 'jpeg') || 'png',
    fullPage: req.query.fullPage === 'true',
    quality: req.query.quality ? parseInt(req.query.quality as string, 10) : undefined,
  };

  logger.info({ browserType, url }, 'Screenshot requested (GET)');

  let resource = null;
  try {
    resource = await browserPool.acquire(browserType, timeout);
    const { page, release } = resource;

    page.setDefaultTimeout(timeout);

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout,
    });

    const playwrightOptions: Parameters<typeof page.screenshot>[0] = {
      type: screenshotOptions.type,
      fullPage: screenshotOptions.fullPage,
    };

    if (screenshotOptions.type === 'jpeg' && screenshotOptions.quality) {
      playwrightOptions.quality = screenshotOptions.quality;
    }

    const screenshot = await page.screenshot(playwrightOptions);

    await release();

    const contentType = screenshotOptions.type === 'jpeg' ? 'image/jpeg' : 'image/png';
    res.set('Content-Type', contentType);
    res.send(screenshot);
  } catch (error) {
    if (resource) {
      try {
        await resource.release();
      } catch (releaseError) {
        logger.warn({ releaseError }, 'Error releasing resource after screenshot error');
      }
    }
    next(error);
  }
});

export default router;
