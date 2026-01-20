import { chromium, firefox, Browser, BrowserContext, Page } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import type { BrowserType, BrowserInstance, PoolConfig, QueuedTask } from '../types/index.js';
import { getPoolConfig, getServerConfig } from '../utils/config.js';
import logger from '../utils/logger.js';
import { BrowserUnavailableError, TimeoutError } from '../middleware/errorHandler.js';

interface BrowserResource {
  context: BrowserContext;
  page: Page;
  release: () => Promise<void>;
}

class BrowserPool {
  private chromiumBrowsers: BrowserInstance[] = [];
  private firefoxBrowsers: BrowserInstance[] = [];
  private queue: QueuedTask[] = [];
  private config: PoolConfig;
  private serverConfig = getServerConfig();
  private isShuttingDown = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.config = getPoolConfig();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing browser pool...');

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupIdleBrowsers(), 60000);

    // Pre-launch browsers if configured
    const preLaunch = parseInt(process.env.PRE_LAUNCH_BROWSERS || '1', 10);

    if (this.serverConfig.enableChromium) {
      for (let i = 0; i < preLaunch; i++) {
        try {
          await this.launchBrowser('chromium');
          logger.info(`Pre-launched Chromium browser ${i + 1}/${preLaunch}`);
        } catch (error) {
          logger.error({ error }, 'Failed to pre-launch Chromium browser');
        }
      }
    }

    if (this.serverConfig.enableFirefox) {
      for (let i = 0; i < preLaunch; i++) {
        try {
          await this.launchBrowser('firefox');
          logger.info(`Pre-launched Firefox browser ${i + 1}/${preLaunch}`);
        } catch (error) {
          logger.error({ error }, 'Failed to pre-launch Firefox browser');
        }
      }
    }

    logger.info('Browser pool initialized');
  }

  private getBrowserLaunchArgs(): string[] {
    // Arguments optimized for running in Docker without SYS_ADMIN capabilities
    // Note: --no-sandbox is the key flag. We don't use --single-process as it's unstable.
    // Instead, we rely on proper shm_size in Docker (1gb+) for stability.
    return [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-default-browser-check',
      '--safebrowsing-disable-auto-update',
    ];
  }

  private async launchBrowser(type: BrowserType): Promise<BrowserInstance> {
    const launcher = type === 'chromium' ? chromium : firefox;
    const args = type === 'chromium' ? this.getBrowserLaunchArgs() : [];

    // Check for custom executable path (for Alpine/minimal builds)
    const executablePath = type === 'chromium'
      ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      : undefined;

    const browser = await launcher.launch({
      headless: true,
      args,
      ...(executablePath && { executablePath }),
      // Firefox-specific options
      ...(type === 'firefox' && {
        firefoxUserPrefs: {
          'dom.ipc.processCount': 1,
          'browser.tabs.remote.autostart': false,
        },
      }),
    });

    const instance: BrowserInstance = {
      id: uuidv4(),
      browser,
      type,
      createdAt: new Date(),
      lastUsed: new Date(),
      inUse: false,
    };

    // Handle browser disconnection
    browser.on('disconnected', () => {
      logger.warn({ browserId: instance.id, type }, 'Browser disconnected');
      this.removeBrowser(instance);
    });

    if (type === 'chromium') {
      this.chromiumBrowsers.push(instance);
    } else {
      this.firefoxBrowsers.push(instance);
    }

    logger.debug({ browserId: instance.id, type }, 'Browser launched');
    return instance;
  }

  private removeBrowser(instance: BrowserInstance): void {
    const list = instance.type === 'chromium' ? this.chromiumBrowsers : this.firefoxBrowsers;
    const index = list.findIndex((b) => b.id === instance.id);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }

  private getBrowserList(type: BrowserType): BrowserInstance[] {
    return type === 'chromium' ? this.chromiumBrowsers : this.firefoxBrowsers;
  }

  private async getAvailableBrowser(type: BrowserType): Promise<BrowserInstance | null> {
    const list = this.getBrowserList(type);

    // Find an available browser
    for (const instance of list) {
      if (!instance.inUse && instance.browser.isConnected()) {
        return instance;
      }
    }

    // Launch a new browser if under limit
    if (list.length < this.config.maxBrowsers) {
      try {
        return await this.launchBrowser(type);
      } catch (error) {
        logger.error({ error, type }, 'Failed to launch new browser');
      }
    }

    return null;
  }

  async acquire(type: BrowserType = 'chromium', timeout?: number): Promise<BrowserResource> {
    if (this.isShuttingDown) {
      throw new BrowserUnavailableError('Pool is shutting down');
    }

    // Validate browser type is enabled
    if (type === 'chromium' && !this.serverConfig.enableChromium) {
      throw new BrowserUnavailableError('Chromium is not enabled');
    }
    if (type === 'firefox' && !this.serverConfig.enableFirefox) {
      throw new BrowserUnavailableError('Firefox is not enabled');
    }

    const effectiveTimeout = timeout || this.config.browserTimeout;

    // Try to get an available browser immediately
    const browser = await this.getAvailableBrowser(type);
    if (browser) {
      return this.createResource(browser);
    }

    // Queue the request and wait
    return new Promise((resolve, reject) => {
      const task: QueuedTask = {
        id: uuidv4(),
        resolve,
        reject,
        browserType: type,
        createdAt: new Date(),
      };

      this.queue.push(task);
      logger.debug({ taskId: task.id, queueLength: this.queue.length }, 'Task queued');

      // Set timeout
      const timeoutId = setTimeout(() => {
        const index = this.queue.findIndex((t) => t.id === task.id);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new TimeoutError('Timeout waiting for available browser'));
        }
      }, effectiveTimeout);

      // Store timeout ID for cleanup
      (task as any).timeoutId = timeoutId;
    });
  }

  private async createResource(instance: BrowserInstance): Promise<BrowserResource> {
    instance.inUse = true;
    instance.lastUsed = new Date();

    const context = await instance.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    const release = async () => {
      try {
        await page.close();
        await context.close();
      } catch (error) {
        logger.warn({ error, browserId: instance.id }, 'Error closing page/context');
      } finally {
        instance.inUse = false;
        instance.lastUsed = new Date();
        this.processQueue();
      }
    };

    return { context, page, release };
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) return;

    // Process queued tasks
    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];
      const browser = await this.getAvailableBrowser(task.browserType);

      if (browser) {
        this.queue.splice(i, 1);
        clearTimeout((task as any).timeoutId);

        try {
          const resource = await this.createResource(browser);
          task.resolve(resource);
        } catch (error) {
          task.reject(error as Error);
        }
        return;
      }
    }
  }

  private async cleanupIdleBrowsers(): Promise<void> {
    const now = Date.now();

    for (const type of ['chromium', 'firefox'] as BrowserType[]) {
      const list = this.getBrowserList(type);
      const toRemove: BrowserInstance[] = [];

      for (const instance of list) {
        // Keep at least one browser per type
        if (list.length - toRemove.length <= 1) break;

        // Remove idle browsers
        if (
          !instance.inUse &&
          now - instance.lastUsed.getTime() > this.config.idleTimeout
        ) {
          toRemove.push(instance);
        }
      }

      for (const instance of toRemove) {
        try {
          await instance.browser.close();
          this.removeBrowser(instance);
          logger.info({ browserId: instance.id, type }, 'Closed idle browser');
        } catch (error) {
          logger.warn({ error, browserId: instance.id }, 'Error closing idle browser');
        }
      }
    }
  }

  getStats(): {
    chromium: { total: number; inUse: number; available: number };
    firefox: { total: number; inUse: number; available: number };
    queueLength: number;
  } {
    const chromiumInUse = this.chromiumBrowsers.filter((b) => b.inUse).length;
    const firefoxInUse = this.firefoxBrowsers.filter((b) => b.inUse).length;

    return {
      chromium: {
        total: this.chromiumBrowsers.length,
        inUse: chromiumInUse,
        available: this.chromiumBrowsers.length - chromiumInUse,
      },
      firefox: {
        total: this.firefoxBrowsers.length,
        inUse: firefoxInUse,
        available: this.firefoxBrowsers.length - firefoxInUse,
      },
      queueLength: this.queue.length,
    };
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    logger.info('Shutting down browser pool...');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Reject all queued tasks
    for (const task of this.queue) {
      clearTimeout((task as any).timeoutId);
      task.reject(new BrowserUnavailableError('Pool is shutting down'));
    }
    this.queue = [];

    // Close all browsers
    const allBrowsers = [...this.chromiumBrowsers, ...this.firefoxBrowsers];
    await Promise.all(
      allBrowsers.map(async (instance) => {
        try {
          await instance.browser.close();
        } catch (error) {
          logger.warn({ error, browserId: instance.id }, 'Error closing browser during shutdown');
        }
      })
    );

    this.chromiumBrowsers = [];
    this.firefoxBrowsers = [];
    logger.info('Browser pool shutdown complete');
  }
}

// Export singleton instance
export const browserPool = new BrowserPool();
