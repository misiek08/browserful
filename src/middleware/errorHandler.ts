import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js';

export class BrowserfulError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'BrowserfulError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class TimeoutError extends BrowserfulError {
  constructor(message = 'Operation timed out') {
    super(message, 408, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends BrowserfulError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class BrowserUnavailableError extends BrowserfulError {
  constructor(message = 'No browser available') {
    super(message, 503, 'BROWSER_UNAVAILABLE');
    this.name = 'BrowserUnavailableError';
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error({ err, path: req.path, method: req.method }, 'Request error');

  if (err instanceof BrowserfulError) {
    res.status(err.statusCode).json({
      error: err.name,
      code: err.code,
      message: err.message,
    });
    return;
  }

  // Handle Playwright errors
  if (err.message.includes('Target closed') || err.message.includes('Browser closed')) {
    res.status(500).json({
      error: 'BrowserError',
      code: 'BROWSER_CLOSED',
      message: 'Browser was closed unexpectedly',
    });
    return;
  }

  if (err.message.includes('Timeout') || err.message.includes('timeout')) {
    res.status(408).json({
      error: 'TimeoutError',
      code: 'TIMEOUT',
      message: err.message,
    });
    return;
  }

  // Generic error
  res.status(500).json({
    error: 'InternalError',
    code: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'production' ? 'An internal error occurred' : err.message,
  });
}
