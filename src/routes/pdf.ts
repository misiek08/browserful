import { Router, Request, Response, NextFunction } from 'express';
import { browserPool } from '../services/browserPool.js';
import { ValidationError } from '../middleware/errorHandler.js';
import { getServerConfig } from '../utils/config.js';
import logger from '../utils/logger.js';
import type { PDFRequest, BrowserType, PDFOptions, GotoOptions, ViewportOptions } from '../types/index.js';

const router = Router();

/**
 * POST /pdf
 *
 * Generate a PDF from a URL, HTML content, or by executing custom code.
 * Can also execute code and return a specific string instead of PDF.
 *
 * Request body:
 * - url: URL to navigate to
 * - html: HTML content to render
 * - code: JavaScript code to execute (can return string to override PDF)
 * - options: PDF generation options
 * - timeout: timeout in milliseconds
 * - browserType: 'chromium' or 'firefox'
 * - gotoOptions: navigation options
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const config = getServerConfig();
  const body = req.body as PDFRequest;

  // Validate request - must have url, html, or code
  if (!body.url && !body.html && !body.code) {
    return next(new ValidationError('One of url, html, or code is required'));
  }

  const browserType: BrowserType = body.browserType || 'chromium';
  const timeout = body.timeout || config.defaultTimeout;
  const pdfOptions = body.options || {};
  const gotoOptions: GotoOptions = body.gotoOptions || { waitUntil: 'networkidle' };
  const viewport = body.viewport;

  logger.info(
    { browserType, hasUrl: !!body.url, hasHtml: !!body.html, hasCode: !!body.code },
    'PDF generation requested'
  );

  let resource = null;
  try {
    resource = await browserPool.acquire(browserType, timeout, viewport);
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
      const result = await fn(page, context);

      // If code returns a string, return it instead of PDF
      if (typeof result === 'string') {
        await release();
        res.set('Content-Type', 'text/plain');
        res.send(result);
        return;
      }

      // If code returns an object with type 'json', return as JSON
      if (result && typeof result === 'object' && result._responseType === 'json') {
        await release();
        delete result._responseType;
        res.json(result);
        return;
      }
    }

    // Generate PDF
    const playwrightOptions: Parameters<typeof page.pdf>[0] = {
      printBackground: pdfOptions.printBackground ?? true,
      format: pdfOptions.format || 'A4',
      landscape: pdfOptions.landscape,
      scale: pdfOptions.scale,
      displayHeaderFooter: pdfOptions.displayHeaderFooter,
      headerTemplate: pdfOptions.headerTemplate,
      footerTemplate: pdfOptions.footerTemplate,
      pageRanges: pdfOptions.pageRanges,
      margin: pdfOptions.margin,
    };

    // Handle custom width/height
    if (pdfOptions.width || pdfOptions.height) {
      delete playwrightOptions.format;
      playwrightOptions.width = pdfOptions.width;
      playwrightOptions.height = pdfOptions.height;
    }

    const pdf = await page.pdf(playwrightOptions);

    await release();

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline; filename="document.pdf"');
    res.send(pdf);
  } catch (error) {
    if (resource) {
      try {
        await resource.release();
      } catch (releaseError) {
        logger.warn({ releaseError }, 'Error releasing resource after PDF error');
      }
    }
    next(error);
  }
});

/**
 * GET /pdf
 *
 * Generate a PDF from a URL passed as query parameter.
 *
 * Query params:
 * - url: URL to convert to PDF
 * - browserType: 'chromium' or 'firefox'
 * - format: PDF format (A4, Letter, etc.)
 * - landscape: true/false
 * - printBackground: true/false
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

  const pdfOptions: PDFOptions = {
    format: (req.query.format as PDFOptions['format']) || 'A4',
    landscape: req.query.landscape === 'true',
    printBackground: req.query.printBackground !== 'false',
  };

  logger.info({ browserType, url }, 'PDF generation requested (GET)');

  let resource = null;
  try {
    resource = await browserPool.acquire(browserType, timeout, viewport);
    const { page, release } = resource;

    page.setDefaultTimeout(timeout);

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout,
    });

    const pdf = await page.pdf({
      printBackground: pdfOptions.printBackground ?? true,
      format: pdfOptions.format,
      landscape: pdfOptions.landscape,
    });

    await release();

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline; filename="document.pdf"');
    res.send(pdf);
  } catch (error) {
    if (resource) {
      try {
        await resource.release();
      } catch (releaseError) {
        logger.warn({ releaseError }, 'Error releasing resource after PDF error');
      }
    }
    next(error);
  }
});

export default router;
