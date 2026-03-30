import express, { Router, Request, Response, NextFunction } from 'express';
import { browserPool } from '../services/browserPool.js';
import { ValidationError } from '../middleware/errorHandler.js';
import { getServerConfig } from '../utils/config.js';
import logger from '../utils/logger.js';
import type { BrowserType, ViewportOptions } from '../types/index.js';
import { wrapPageWithCompat } from '../utils/normalizeWaitUntil.js';

const router = Router();

// Support application/javascript content-type 
router.use(express.text({ type: 'application/javascript', limit: '10mb' }));

/**
 * Extract code and context from the request body.
 * Supports both application/javascript (raw code) and application/json ({code, context}).
 */
function extractCodeAndContext(req: Request): { code: string; context: Record<string, unknown> } {
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('application/javascript')) {
    // Raw JavaScript code sent as text
    const code = typeof req.body === 'string' ? req.body : '';
    if (!code.trim()) {
      throw new ValidationError('code is required');
    }
    return { code, context: {} };
  }

  // application/json
  const body = req.body;
  if (!body || !body.code || typeof body.code !== 'string') {
    throw new ValidationError('code is required and must be a string');
  }
  return { code: body.code, context: body.context || {} };
}

/**
 * Execute user code. 
 *
 * The code uses ESM syntax: `export default async ({ page, context }) => { ... }`
 * or can be a plain function body.
 *
 * The function should return:
 * - An object with { data, type } where type is the Content-Type
 * - A Buffer (e.g. from page.pdf()) which is sent as application/octet-stream
 */
async function executeFunction(
  code: string,
  userContext: Record<string, unknown>,
  browserType: BrowserType,
  timeout: number,
  viewport?: ViewportOptions
): Promise<{ data: unknown; type: string } | Buffer> {
  const resource = await browserPool.acquire(browserType, timeout, viewport);
  const { page, release } = resource;

  try {
    page.setDefaultTimeout(timeout);

    // Wrap page with Puppeteer→Playwright compatibility Proxy
    const compatPage = wrapPageWithCompat(page);

    // Transform ESM export default syntax into an executable function
    // Handles: export default async ({ page, context }) => { ... }
    // and:     export default async function({ page, context }) { ... }
    let normalizedCode = code;

    // Remove import statements (there can be ESM imports over HTTP,
    // but we can't resolve them server-side; strip them for safety)
    normalizedCode = normalizedCode.replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '');

    // Replace "export default async ..." with a module.exports-style assignment
    normalizedCode = normalizedCode.replace(
      /export\s+default\s+async\s+/,
      'const __fn = async '
    );
    // Also handle "export default function" (non-async)
    normalizedCode = normalizedCode.replace(
      /export\s+default\s+function\s*/,
      'const __fn = async function '
    );
    // Handle "export default" with arrow or expression
    if (!normalizedCode.includes('__fn')) {
      normalizedCode = normalizedCode.replace(/export\s+default\s+/, 'const __fn = ');
    }

    // If the code already defines __fn (ESM transformed), wrap it;
    // otherwise treat the whole code as a legacy function body.
    let executableCode: string;
    if (normalizedCode.includes('__fn')) {
      // ESM-style: evaluate and call the exported function
      executableCode = `
        ${normalizedCode};
        return __fn({ page, context });
      `;
    } else {
      // Legacy function-body style (backward compat)
      executableCode = `
        return (async () => {
          ${normalizedCode}
        })();
      `;
    }

    const fn = new Function('page', 'context', executableCode);

    const resultPromise = fn(compatPage, userContext);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Function execution timed out')), timeout);
    });

    const result = await Promise.race([resultPromise, timeoutPromise]);

    return result;
  } finally {
    try {
      await release();
    } catch (releaseError) {
      logger.warn({ releaseError }, 'Error releasing resource after function execution');
    }
  }
}

/**
 * Send the function result as an HTTP response:
 * - Buffer → application/octet-stream (e.g. PDF, screenshot)
 * - { data, type } → responds with that Content-Type and data
 * - { data } without type → application/json
 */
function sendResult(result: unknown, res: Response): void {
  if (Buffer.isBuffer(result)) {
    res.set('Content-Type', 'application/octet-stream');
    res.send(result);
    return;
  }

  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;

    if ('data' in obj) {
      const type = (obj.type as string) || 'application/json';
      res.set('Content-Type', type);

      if (type === 'application/json') {
        res.json(obj.data);
      } else if (type.startsWith('text/')) {
        res.send(String(obj.data));
      } else {
        // For binary types, data might be a Buffer or base64 string
        if (Buffer.isBuffer(obj.data)) {
          res.send(obj.data);
        } else {
          res.send(obj.data);
        }
      }
      return;
    }
  }

  // Fallback: send as JSON
  res.json(result);
}

/**
 * POST /function
 *
 * Execute JavaScript code in a browser context and return the result.
 * Browserless-compatible: supports both application/javascript and application/json.
 *
 * application/javascript body:
 *   export default async ({ page }) => {
 *     await page.goto("https://example.com");
 *     return { data: { title: await page.title() }, type: "application/json" };
 *   };
 *
 * application/json body:
 *   { "code": "...", "context": { "key": "value" } }
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getServerConfig();
    const { code, context: userContext } = extractCodeAndContext(req);

    const contentType = req.headers['content-type'] || '';
    const body = contentType.includes('application/javascript') ? {} : req.body;

    const browserType: BrowserType = body.browserType || 'chromium';
    const timeout = body.timeout || config.defaultTimeout;
    const viewport = body.viewport;

    logger.info(
      { browserType, contentType, hasContext: Object.keys(userContext).length > 0 },
      'Function execution requested'
    );

    const result = await executeFunction(code, userContext, browserType, timeout, viewport);
    sendResult(result, res);
  } catch (error) {
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
  try {
    const config = getServerConfig();

    const code = req.query.code as string;
    if (!code) {
      return next(new ValidationError('code query parameter is required'));
    }

    const browserType = (req.query.browserType as BrowserType) || 'chromium';
    const timeout = parseInt(req.query.timeout as string, 10) || config.defaultTimeout;
    const viewport: ViewportOptions | undefined = req.query.width || req.query.height
      ? {
          width: req.query.width ? parseInt(req.query.width as string, 10) : undefined,
          height: req.query.height ? parseInt(req.query.height as string, 10) : undefined,
        }
      : undefined;

    logger.info({ browserType }, 'Function execution requested (GET)');

    const result = await executeFunction(code, {}, browserType, timeout, viewport);
    sendResult(result, res);
  } catch (error) {
    next(error);
  }
});

export default router;
