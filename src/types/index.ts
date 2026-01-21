import type { Browser, BrowserContext, Page } from 'playwright';

export type BrowserType = 'chromium' | 'firefox';

export interface ViewportOptions {
  width?: number;
  height?: number;
}

export interface BrowserInstance {
  id: string;
  browser: Browser;
  type: BrowserType;
  createdAt: Date;
  lastUsed: Date;
  inUse: boolean;
}

export interface PoolConfig {
  maxBrowsers: number;
  maxPagesPerBrowser: number;
  browserTimeout: number;
  pageTimeout: number;
  idleTimeout: number;
}

export interface ServerConfig {
  port: number;
  host: string;
  token?: string;
  maxConcurrent: number;
  defaultTimeout: number;
  enableChromium: boolean;
  enableFirefox: boolean;
  debugMode: boolean;
}

export interface FunctionRequest {
  code: string;
  context?: Record<string, unknown>;
  timeout?: number;
  browserType?: BrowserType;
  viewport?: ViewportOptions;
}

export interface FunctionResponse {
  data: unknown;
  type: string;
}

export interface PDFRequest {
  url?: string;
  html?: string;
  code?: string;
  options?: PDFOptions;
  timeout?: number;
  browserType?: BrowserType;
  gotoOptions?: GotoOptions;
  viewport?: ViewportOptions;
}

export interface PDFOptions {
  format?: 'Letter' | 'Legal' | 'Tabloid' | 'Ledger' | 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6';
  width?: string | number;
  height?: string | number;
  scale?: number;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  printBackground?: boolean;
  landscape?: boolean;
  pageRanges?: string;
  margin?: {
    top?: string | number;
    right?: string | number;
    bottom?: string | number;
    left?: string | number;
  };
}

export interface ScreenshotRequest {
  url?: string;
  html?: string;
  code?: string;
  options?: ScreenshotOptions;
  timeout?: number;
  browserType?: BrowserType;
  gotoOptions?: GotoOptions;
  viewport?: ViewportOptions;
}

export interface ScreenshotOptions {
  type?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  omitBackground?: boolean;
  encoding?: 'base64' | 'binary';
}

export interface ScrapeRequest {
  url: string;
  elements: ScrapeElement[];
  timeout?: number;
  browserType?: BrowserType;
  gotoOptions?: GotoOptions;
  waitForSelector?: string;
  viewport?: ViewportOptions;
}

export interface ScrapeElement {
  selector: string;
  timeout?: number;
}

export interface GotoOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  timeout?: number;
  referer?: string;
}

export interface ContentRequest {
  url: string;
  timeout?: number;
  browserType?: BrowserType;
  gotoOptions?: GotoOptions;
  viewport?: ViewportOptions;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  browsers: {
    chromium: BrowserHealth;
    firefox: BrowserHealth;
  };
  uptime: number;
  version: string;
}

export interface BrowserHealth {
  enabled: boolean;
  available: number;
  inUse: number;
  total: number;
}

export interface QueuedTask {
  id: string;
  resolve: (value: { context: BrowserContext; page: Page; release: () => Promise<void> }) => void;
  reject: (error: Error) => void;
  browserType: BrowserType;
  createdAt: Date;
}
