# Browserful - Lightweight headless browser service
# Runs without SYS_ADMIN capabilities

FROM node:20-slim

# Install dependencies for Playwright browsers
# These are the minimal dependencies needed to run Chromium and Firefox
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Common dependencies
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    libfontconfig1 \
    # Chromium dependencies
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    xdg-utils \
    # Firefox dependencies
    libdbus-glib-1-2 \
    libxt6 \
    # Cleanup
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create app directory
WORKDIR /app

# Create non-root user for security
RUN groupadd -r browserful && useradd -r -g browserful -G audio,video browserful \
    && mkdir -p /home/browserful/Downloads \
    && chown -R browserful:browserful /home/browserful \
    && chown -R browserful:browserful /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Install Playwright browsers (as root, then fix permissions)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium firefox \
    && chmod -R 755 /ms-playwright

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Fix ownership
RUN chown -R browserful:browserful /app

# Switch to non-root user
USER browserful

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Environment defaults
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    ENABLE_CHROMIUM=true \
    ENABLE_FIREFOX=false \
    MAX_BROWSERS=5 \
    MAX_CONCURRENT=10 \
    DEFAULT_TIMEOUT=30000 \
    PRE_LAUNCH_BROWSERS=1

# Start the service
CMD ["node", "dist/index.js"]
