# Browserful

A lightweight, secure headless browser service. Run Chrome and Firefox in Docker without SYS_ADMIN capabilities or special privileges.

## Features

- **No Special Privileges**: Runs in Docker without `SYS_ADMIN` capabilities or `seccomp:unconfined`
- **Multi-Browser Support**: Chromium and Firefox engines available
- **Simple Authentication**: Token-based auth via URL param, header, or Bearer token
- **Browser Pool**: Efficient resource management with browser reuse
- **Multiple Endpoints**:
  - `/function` - Execute JavaScript in browser context
  - `/pdf` - Generate PDFs from URLs, HTML, or code
  - `/screenshot` - Capture screenshots
  - `/scrape` - Extract data from pages
  - `/content` - Get rendered HTML
- **Production Ready**: Health checks, Prometheus metrics, graceful shutdown
- **Low Resource Usage**: Configurable limits, idle browser cleanup

## Quick Start

### Docker Compose (Recommended)

```bash
# With authentication
BROWSERFUL_TOKEN=your-secret-token docker-compose up

# Without authentication (development only)
docker-compose up
```

### Docker

```bash
# Build
docker build -t browserful .

# Run with auth
docker run -p 3000:3000 -e TOKEN=your-secret-token browserful

# Run without auth (development only)
docker run -p 3000:3000 browserful
```

### Local Development

```bash
npm install
npx playwright install chromium
npm run dev
```

## Authentication

Set the `TOKEN` environment variable to enable authentication. Clients can provide the token via:

1. **Query Parameter**: `?token=your-secret-token`
2. **Authorization Header**: `Authorization: Bearer your-secret-token`
3. **API Key Header**: `X-API-Key: your-secret-token`

If no `TOKEN` is set, all requests are allowed (development mode).

## API Endpoints

### Execute JavaScript - `/function`

Execute custom JavaScript code in a browser context.

```bash
# POST with code
curl -X POST http://localhost:3000/function?token=xxx \
  -H "Content-Type: application/json" \
  -d '{
    "code": "await page.goto(\"https://example.com\"); return await page.title();"
  }'

# With context data
curl -X POST http://localhost:3000/function?token=xxx \
  -H "Content-Type: application/json" \
  -d '{
    "code": "await page.goto(data.url); return await page.title();",
    "context": { "url": "https://example.com" }
  }'
```

The `code` receives:
- `page` - Playwright Page object
- `context` - Playwright BrowserContext
- `data` - Your custom context object

### Generate PDF - `/pdf`

```bash
# From URL
curl -X POST http://localhost:3000/pdf?token=xxx \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' \
  -o output.pdf

# From HTML
curl -X POST http://localhost:3000/pdf?token=xxx \
  -H "Content-Type: application/json" \
  -d '{"html": "<h1>Hello World</h1>"}' \
  -o output.pdf

# With custom code (return string to skip PDF)
curl -X POST http://localhost:3000/pdf?token=xxx \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "code": "await page.waitForSelector(\".loaded\"); return \"Page loaded!\";",
  }'

# GET shorthand
curl "http://localhost:3000/pdf?token=xxx&url=https://example.com" -o output.pdf
```

PDF Options:
- `format`: A0-A6, Letter, Legal, Tabloid, Ledger
- `landscape`: true/false
- `printBackground`: true/false
- `scale`: 0.1-2
- `margin`: { top, right, bottom, left }
- `headerTemplate`, `footerTemplate`
- `pageRanges`: e.g., "1-5, 8"

### Take Screenshot - `/screenshot`

```bash
# From URL
curl -X POST http://localhost:3000/screenshot?token=xxx \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' \
  -o screenshot.png

# Full page JPEG
curl -X POST http://localhost:3000/screenshot?token=xxx \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "options": {
      "fullPage": true,
      "type": "jpeg",
      "quality": 80
    }
  }' \
  -o screenshot.jpg

# GET shorthand
curl "http://localhost:3000/screenshot?token=xxx&url=https://example.com&fullPage=true" -o screenshot.png
```

Screenshot Options:
- `type`: png, jpeg
- `quality`: 1-100 (jpeg only)
- `fullPage`: true/false
- `clip`: { x, y, width, height }
- `omitBackground`: true/false
- `encoding`: base64, binary

### Scrape Elements - `/scrape`

```bash
# Scrape multiple selectors
curl -X POST http://localhost:3000/scrape?token=xxx \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "elements": [
      { "selector": "h1" },
      { "selector": "a" }
    ]
  }'

# GET shorthand (single selector)
curl "http://localhost:3000/scrape?token=xxx&url=https://example.com&selector=h1"
```

### Get Rendered Content - `/content`

```bash
# Get fully rendered HTML
curl -X POST http://localhost:3000/content?token=xxx \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# GET shorthand
curl "http://localhost:3000/content?token=xxx&url=https://example.com"
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `HOST` | 0.0.0.0 | Server host |
| `TOKEN` | (none) | Authentication token |
| `ENABLE_CHROMIUM` | true | Enable Chromium browser |
| `ENABLE_FIREFOX` | false | Enable Firefox browser |
| `MAX_BROWSERS` | 5 | Maximum browser instances per type |
| `MAX_CONCURRENT` | 10 | Maximum concurrent requests |
| `DEFAULT_TIMEOUT` | 30000 | Default timeout in ms |
| `PRE_LAUNCH_BROWSERS` | 1 | Browsers to launch on startup |
| `IDLE_TIMEOUT` | 300000 | Close idle browsers after (ms) |
| `LOG_LEVEL` | info | Logging level |

## Health & Metrics

```bash
# Health check
curl http://localhost:3000/health

# Kubernetes probes
curl http://localhost:3000/health/ready
curl http://localhost:3000/health/live

# Prometheus metrics
curl http://localhost:3000/metrics
```

## Browser Selection

Use the `browserType` parameter to choose the browser:

```bash
# Use Firefox
curl -X POST http://localhost:3000/screenshot?token=xxx \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "browserType": "firefox"
  }'
```

Make sure to enable Firefox with `ENABLE_FIREFOX=true`.

## Resource Optimization

Browserful is designed for low resource usage:

1. **Browser Pooling**: Reuses browser instances
2. **Idle Cleanup**: Automatically closes unused browsers
3. **Configurable Limits**: Set `MAX_BROWSERS` and `MAX_CONCURRENT`
4. **Minimal Docker Image**: Use `Dockerfile.minimal` for smallest footprint

### Docker Resource Limits

```yaml
deploy:
  resources:
    limits:
      memory: 2G
      cpus: '2'
    reservations:
      memory: 512M
```

## Why No SYS_ADMIN?

Browserful uses specific Chromium flags to run without elevated privileges:

- `--no-sandbox` - Disables Chrome's sandbox (safe in containerized environments)
- `--disable-setuid-sandbox` - Disables setuid sandbox
- `--disable-dev-shm-usage` - Uses /tmp instead of /dev/shm

Combined with proper Docker configuration (`shm_size: 1gb`), this makes it safe to run in restricted container environments like:
- Kubernetes with PodSecurityPolicy
- AWS ECS/Fargate
- Google Cloud Run
- Azure Container Instances

## License

MIT
