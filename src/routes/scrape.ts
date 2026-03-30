import { Router, Request, Response, NextFunction } from 'express';
import { browserPool } from '../services/browserPool.js';
import { ValidationError } from '../middleware/errorHandler.js';
import { getServerConfig } from '../utils/config.js';
import logger from '../utils/logger.js';
import type { ScrapeRequest, BrowserType, GotoOptions, ViewportOptions } from '../types/index.js';
import { normalizeWaitUntil } from '../utils/normalizeWaitUntil.js';

const router = Router();

/**
 * POST /scrape
 *
 * Scrape elements from a webpage.
 *
 * Request body:
 * - url: URL to navigate to
 * - elements: Array of selectors to scrape
 * - timeout: timeout in milliseconds
 * - browserType: 'chromium' or 'firefox'
 * - gotoOptions: navigation options
 * - waitForSelector: wait for this selector before scraping
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const config = getServerConfig();
  const body = req.body as ScrapeRequest;

  // Validate request
  if (!body.url) {
    return next(new ValidationError('url is required'));
  }

  if (!body.elements || !Array.isArray(body.elements) || body.elements.length === 0) {
    return next(new ValidationError('elements array is required and must not be empty'));
  }

  const browserType: BrowserType = body.browserType || 'chromium';
  const timeout = body.timeout || config.defaultTimeout;
  const gotoOptions: GotoOptions = body.gotoOptions || { waitUntil: 'networkidle' };
  const viewport = body.viewport;

  logger.info(
    { browserType, url: body.url, elementCount: body.elements.length },
    'Scrape requested'
  );

  let resource = null;
  try {
    resource = await browserPool.acquire(browserType, timeout, viewport);
    const { page, release } = resource;

    page.setDefaultTimeout(timeout);

    // Navigate to URL
    await page.goto(body.url, {
      waitUntil: normalizeWaitUntil(gotoOptions.waitUntil) || 'networkidle',
      timeout: gotoOptions.timeout || timeout,
      referer: gotoOptions.referer,
    });

    // Wait for specific selector if provided
    if (body.waitForSelector) {
      await page.waitForSelector(body.waitForSelector, { timeout });
    }

    // Scrape elements
    const results: Record<string, { selector: string; results: Array<{ text: string; attributes: Record<string, string> }> }> = {};

    for (const element of body.elements) {
      const selector = element.selector;
      const elementTimeout = element.timeout || timeout;

      try {
        // Wait for at least one element
        await page.waitForSelector(selector, { timeout: elementTimeout });

        // Get all matching elements
        const elements = await page.$$(selector);
        const elementResults: Array<{ text: string; attributes: Record<string, string> }> = [];

        for (const el of elements) {
          const text = await el.textContent();
          const attributes: Record<string, string> = {};

          // Get common attributes
          const commonAttrs = ['href', 'src', 'alt', 'title', 'class', 'id', 'data-*'];
          for (const attr of commonAttrs) {
            if (attr === 'data-*') {
              // Get all data attributes
              const dataAttrs = await el.evaluate((node) => {
                const data: Record<string, string> = {};
                for (const attr of node.attributes) {
                  if (attr.name.startsWith('data-')) {
                    data[attr.name] = attr.value;
                  }
                }
                return data;
              });
              Object.assign(attributes, dataAttrs);
            } else {
              const value = await el.getAttribute(attr);
              if (value !== null) {
                attributes[attr] = value;
              }
            }
          }

          elementResults.push({
            text: text?.trim() || '',
            attributes,
          });
        }

        results[selector] = {
          selector,
          results: elementResults,
        };
      } catch (error) {
        // If element not found, return empty results
        results[selector] = {
          selector,
          results: [],
        };
      }
    }

    await release();

    res.json({
      url: body.url,
      data: results,
    });
  } catch (error) {
    if (resource) {
      try {
        await resource.release();
      } catch (releaseError) {
        logger.warn({ releaseError }, 'Error releasing resource after scrape error');
      }
    }
    next(error);
  }
});

/**
 * GET /scrape
 *
 * Simple scrape endpoint for single selector.
 *
 * Query params:
 * - url: URL to scrape
 * - selector: CSS selector to scrape
 * - browserType: 'chromium' or 'firefox'
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const config = getServerConfig();

  const url = req.query.url as string;
  const selector = req.query.selector as string;

  if (!url) {
    return next(new ValidationError('url query parameter is required'));
  }

  if (!selector) {
    return next(new ValidationError('selector query parameter is required'));
  }

  const browserType = (req.query.browserType as BrowserType) || 'chromium';
  const timeout = parseInt(req.query.timeout as string, 10) || config.defaultTimeout;
  const viewport: ViewportOptions | undefined = req.query.width || req.query.height
    ? {
        width: req.query.width ? parseInt(req.query.width as string, 10) : undefined,
        height: req.query.height ? parseInt(req.query.height as string, 10) : undefined,
      }
    : undefined;

  logger.info({ browserType, url, selector }, 'Scrape requested (GET)');

  let resource = null;
  try {
    resource = await browserPool.acquire(browserType, timeout, viewport);
    const { page, release } = resource;

    page.setDefaultTimeout(timeout);

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout,
    });

    // Wait for selector
    await page.waitForSelector(selector, { timeout });

    // Get all matching elements
    const elements = await page.$$(selector);
    const results: Array<{ text: string; html: string }> = [];

    for (const el of elements) {
      const text = await el.textContent();
      const html = await el.innerHTML();
      results.push({
        text: text?.trim() || '',
        html,
      });
    }

    await release();

    res.json({
      url,
      selector,
      results,
    });
  } catch (error) {
    if (resource) {
      try {
        await resource.release();
      } catch (releaseError) {
        logger.warn({ releaseError }, 'Error releasing resource after scrape error');
      }
    }
    next(error);
  }
});

export default router;
