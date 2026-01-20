import type { Request, Response, NextFunction } from 'express';
import { getServerConfig } from '../utils/config.js';
import logger from '../utils/logger.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const config = getServerConfig();

  // If no token is configured, allow all requests
  if (!config.token) {
    next();
    return;
  }

  // Check for token in query params
  const queryToken = req.query.token as string | undefined;

  // Check for token in Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;

  // Check for token in X-API-Key header
  const apiKeyToken = req.headers['x-api-key'] as string | undefined;

  const providedToken = queryToken || bearerToken || apiKeyToken;

  if (!providedToken) {
    logger.warn({ path: req.path, ip: req.ip }, 'Missing authentication token');
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication token required. Provide via ?token=, Authorization: Bearer, or X-API-Key header.',
    });
    return;
  }

  if (providedToken !== config.token) {
    logger.warn({ path: req.path, ip: req.ip }, 'Invalid authentication token');
    res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid authentication token.',
    });
    return;
  }

  next();
}
