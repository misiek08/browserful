#!/bin/bash
# Browserful API Examples using curl
# Set your token and base URL

BASE_URL="${BROWSERFUL_URL:-http://localhost:3000}"
TOKEN="${BROWSERFUL_TOKEN:-}"

# Helper function to add token to URL
url() {
  if [ -n "$TOKEN" ]; then
    echo "${BASE_URL}${1}?token=${TOKEN}"
  else
    echo "${BASE_URL}${1}"
  fi
}

echo "=== Health Check ==="
curl -s "$(url /health)" | jq .

echo ""
echo "=== Execute JavaScript Function ==="
curl -s -X POST "$(url /function)" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "await page.goto(\"https://example.com\"); return await page.title();"
  }' | jq .

echo ""
echo "=== Take Screenshot (save to file) ==="
curl -s -X POST "$(url /screenshot)" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "options": {
      "fullPage": false,
      "type": "png"
    }
  }' -o /tmp/screenshot.png
echo "Screenshot saved to /tmp/screenshot.png"
ls -la /tmp/screenshot.png

echo ""
echo "=== Generate PDF (save to file) ==="
curl -s -X POST "$(url /pdf)" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "options": {
      "format": "A4",
      "printBackground": true
    }
  }' -o /tmp/document.pdf
echo "PDF saved to /tmp/document.pdf"
ls -la /tmp/document.pdf

echo ""
echo "=== Generate PDF from HTML ==="
curl -s -X POST "$(url /pdf)" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<html><body><h1>Hello World!</h1><p>Generated at: '"$(date)"'</p></body></html>",
    "options": {
      "format": "Letter"
    }
  }' -o /tmp/hello.pdf
echo "PDF saved to /tmp/hello.pdf"

echo ""
echo "=== Scrape Elements ==="
curl -s -X POST "$(url /scrape)" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "elements": [
      { "selector": "h1" },
      { "selector": "p" }
    ]
  }' | jq .

echo ""
echo "=== Get Rendered Content ==="
curl -s -X POST "$(url /content)" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com"
  }' | head -20

echo ""
echo "=== Execute with Context Data ==="
curl -s -X POST "$(url /function)" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "await page.goto(data.searchUrl + encodeURIComponent(data.query)); return await page.title();",
    "context": {
      "searchUrl": "https://www.google.com/search?q=",
      "query": "playwright"
    }
  }' | jq .

echo ""
echo "=== GET shortcuts ==="
echo "Screenshot via GET:"
curl -s "$(url /screenshot)?url=https://example.com&fullPage=true" -o /tmp/screenshot-get.png
ls -la /tmp/screenshot-get.png

echo ""
echo "PDF via GET:"
curl -s "$(url /pdf)?url=https://example.com&format=A4" -o /tmp/document-get.pdf
ls -la /tmp/document-get.pdf

echo ""
echo "=== Prometheus Metrics ==="
curl -s "$(url /metrics)"

echo ""
echo "=== Done! ==="
