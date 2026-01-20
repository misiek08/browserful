import type { ServerConfig, PoolConfig } from '../types/index.js';

export function getServerConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    token: process.env.TOKEN,
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '10', 10),
    defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || '30000', 10),
    enableChromium: process.env.ENABLE_CHROMIUM !== 'false',
    enableFirefox: process.env.ENABLE_FIREFOX === 'true',
    debugMode: process.env.DEBUG === 'true',
  };
}

export function getPoolConfig(): PoolConfig {
  return {
    maxBrowsers: parseInt(process.env.MAX_BROWSERS || '5', 10),
    maxPagesPerBrowser: parseInt(process.env.MAX_PAGES_PER_BROWSER || '5', 10),
    browserTimeout: parseInt(process.env.BROWSER_TIMEOUT || '60000', 10),
    pageTimeout: parseInt(process.env.PAGE_TIMEOUT || '30000', 10),
    idleTimeout: parseInt(process.env.IDLE_TIMEOUT || '300000', 10), // 5 minutes
  };
}
