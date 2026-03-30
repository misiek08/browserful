import type { Page } from 'playwright';

type WaitUntilValue = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

const PUPPETEER_MAP: Record<string, WaitUntilValue> = {
  networkidle2: 'networkidle',
  networkidle0: 'networkidle',
};

export function normalizeWaitUntil(value: unknown): WaitUntilValue | undefined {
  if (typeof value === 'string' && value in PUPPETEER_MAP) {
    return PUPPETEER_MAP[value];
  }
  if (typeof value === 'string') {
    return value as WaitUntilValue;
  }
  return undefined;
}

/**
 * Normalize a single options object: if it has a `waitUntil` field,
 * map Puppeteer values to Playwright equivalents.
 */
function normalizeOptions<T>(options: T): T {
  if (!options || typeof options !== 'object') return options;
  const opts = options as Record<string, unknown>;
  if (typeof opts.waitUntil === 'string') {
    const mapped = normalizeWaitUntil(opts.waitUntil);
    if (mapped !== opts.waitUntil) {
      return { ...options, waitUntil: mapped } as T;
    }
  }
  // Handle array form: waitUntil: ['networkidle2', 'domcontentloaded']
  if (Array.isArray(opts.waitUntil)) {
    const mapped = opts.waitUntil.map(normalizeWaitUntil);
    return { ...options, waitUntil: mapped } as T;
  }
  return options;
}

const METHODS_WITH_WAIT_UNTIL = new Set([
  'goto', 'setContent', 'waitForNavigation', 'waitForURL', 'reload', 'goBack', 'goForward',
]);

/**
 * Wrap a Playwright Page in a Proxy that normalizes Puppeteer-specific
 * `waitUntil` values in navigation methods.
 */
export function wrapPageWithCompat(page: Page): Page {
  return new Proxy(page, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (typeof prop === 'string' && METHODS_WITH_WAIT_UNTIL.has(prop) && typeof value === 'function') {
        return function (...args: unknown[]) {
          if (args.length >= 2 && args[1] && typeof args[1] === 'object') {
            args[1] = normalizeOptions(args[1]);
          }
          return value.apply(target, args);
        };
      }

      // Puppeteer: page.setViewport(obj) → Playwright: page.setViewportSize(obj)
      if (prop === 'setViewport' && typeof value === 'undefined') {
        return function (viewport: { width: number; height: number }) {
          return target.setViewportSize(viewport);
        };
      }

      return value;
    },
  }) as Page;
}
