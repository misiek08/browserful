import { Router, Request, Response, NextFunction } from 'express';
import { browserPool } from '../services/browserPool.js';
import { ValidationError } from '../middleware/errorHandler.js';
import { getServerConfig } from '../utils/config.js';
import logger from '../utils/logger.js';
import type { FunctionRequest, BrowserType } from '../types/index.js';

const router = Router();

/**
 * POST /function
 *
 * Execute JavaScript code in a browser context and return the result.
 * The code should be a function body that can use `page` and optionally `context`.
 *
 * Example request:
 * {
 *   "code": "await page.goto('https://example.com'); return await page.title();",
 *   "context": { "searchTerm": "hello" },
 *   "timeout": 30000,
 *   "browserType": "chromium"
 * }
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const config = getServerConfig();
  const body = req.body as FunctionRequest;

  // Validate request
  if (!body.code || typeof body.code !== 'string') {
    return next(new ValidationError('code is required and must be a string'));
  }

  const browserType: BrowserType = body.browserType || 'chromium';
  const timeout = body.timeout || config.defaultTimeout;
  const userContext = body.context || {};

  logger.info({ browserType, hasContext: Object.keys(userContext).length > 0 }, 'Function execution requested');

  let resource = null;
  try {
    resource = await browserPool.acquire(browserType, timeout);
    const { page, context, release } = resource;

    // Set page timeout
    page.setDefaultTimeout(timeout);

    // Create a wrapped function that receives page, context, and user data
    // The code is executed as an async function body
    const wrappedCode = `
      return (async () => {
        ${body.code}
      })();
    `;

    // Create function with page, context, and user-provided context data
    const fn = new Function('page', 'context', 'data', wrappedCode);

    // Execute with timeout
    const resultPromise = fn(page, context, userContext);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Function execution timed out')), timeout);
    });

    const result = await Promise.race([resultPromise, timeoutPromise]);

    await release();

    // Determine response type
    if (Buffer.isBuffer(result)) {
      res.set('Content-Type', 'application/octet-stream');
      res.send(result);
    } else if (typeof result === 'string') {
      res.set('Content-Type', 'text/plain');
      res.send(result);
    } else {
      res.json({
        data: result,
        type: typeof result,
      });
    }
  } catch (error) {
    if (resource) {
      try {
        await resource.release();
      } catch (releaseError) {
        logger.warn({ releaseError }, 'Error releasing resource after function error');
      }
    }
    next(error);
  }
});

/**
 * GET /function
 *
 * Execute JavaScript code passed as a query parameter.
 * Useful for simple operations or testing.
 *
 * Query params:
 * - code: URL-encoded JavaScript code
 * - browserType: 'chromium' or 'firefox'
 * - timeout: timeout in milliseconds
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const config = getServerConfig();

  const code = req.query.code as string;
  if (!code) {
    return next(new ValidationError('code query parameter is required'));
  }

  const browserType = (req.query.browserType as BrowserType) || 'chromium';
  const timeout = parseInt(req.query.timeout as string, 10) || config.defaultTimeout;

  logger.info({ browserType }, 'Function execution requested (GET)');

  let resource = null;
  try {
    resource = await browserPool.acquire(browserType, timeout);
    const { page, context, release } = resource;

    page.setDefaultTimeout(timeout);

    const wrappedCode = `
      return (async () => {
        ${code}
      })();
    `;

    const fn = new Function('page', 'context', wrappedCode);

    const resultPromise = fn(page, context);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Function execution timed out')), timeout);
    });

    const result = await Promise.race([resultPromise, timeoutPromise]);

    await release();

    if (Buffer.isBuffer(result)) {
      res.set('Content-Type', 'application/octet-stream');
      res.send(result);
    } else if (typeof result === 'string') {
      res.set('Content-Type', 'text/plain');
      res.send(result);
    } else {
      res.json({
        data: result,
        type: typeof result,
      });
    }
  } catch (error) {
    if (resource) {
      try {
        await resource.release();
      } catch (releaseError) {
        logger.warn({ releaseError }, 'Error releasing resource after function error');
      }
    }
    next(error);
  }
});

export default router;
