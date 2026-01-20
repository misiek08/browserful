/**
 * Basic usage examples for Browserful API
 *
 * Run: npx tsx examples/basic-usage.ts
 */

const BASE_URL = process.env.BROWSERFUL_URL || 'http://localhost:3000';
const TOKEN = process.env.BROWSERFUL_TOKEN || '';

function getUrl(path: string): string {
  const url = new URL(path, BASE_URL);
  if (TOKEN) {
    url.searchParams.set('token', TOKEN);
  }
  return url.toString();
}

async function example1_executeFunction() {
  console.log('\n=== Example 1: Execute JavaScript Function ===\n');

  const response = await fetch(getUrl('/function'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: `
        await page.goto('https://example.com');
        const title = await page.title();
        const heading = await page.$eval('h1', el => el.textContent);
        return { title, heading };
      `,
    }),
  });

  const result = await response.json();
  console.log('Result:', result);
}

async function example2_generatePdf() {
  console.log('\n=== Example 2: Generate PDF ===\n');

  const response = await fetch(getUrl('/pdf'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html: `
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; padding: 40px; }
              h1 { color: #333; }
              .invoice { border: 1px solid #ddd; padding: 20px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <h1>Invoice #12345</h1>
            <div class="invoice">
              <p>Date: ${new Date().toLocaleDateString()}</p>
              <p>Amount: $1,234.56</p>
              <p>Status: Paid</p>
            </div>
          </body>
        </html>
      `,
      options: {
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
      },
    }),
  });

  if (response.ok) {
    const buffer = await response.arrayBuffer();
    console.log(`Generated PDF, size: ${buffer.byteLength} bytes`);
    // To save: require('fs').writeFileSync('invoice.pdf', Buffer.from(buffer));
  } else {
    console.error('Error:', await response.json());
  }
}

async function example3_takeScreenshot() {
  console.log('\n=== Example 3: Take Screenshot ===\n');

  const response = await fetch(getUrl('/screenshot'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.com',
      options: {
        fullPage: true,
        type: 'png',
      },
    }),
  });

  if (response.ok) {
    const buffer = await response.arrayBuffer();
    console.log(`Screenshot taken, size: ${buffer.byteLength} bytes`);
    // To save: require('fs').writeFileSync('screenshot.png', Buffer.from(buffer));
  } else {
    console.error('Error:', await response.json());
  }
}

async function example4_scrapeData() {
  console.log('\n=== Example 4: Scrape Data ===\n');

  const response = await fetch(getUrl('/scrape'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.com',
      elements: [
        { selector: 'h1' },
        { selector: 'p' },
      ],
    }),
  });

  const result = await response.json();
  console.log('Scraped data:', JSON.stringify(result, null, 2));
}

async function example5_executeWithContext() {
  console.log('\n=== Example 5: Execute with Context Data ===\n');

  const response = await fetch(getUrl('/function'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: `
        await page.goto(data.url);
        await page.waitForSelector(data.selector);
        const elements = await page.$$(data.selector);
        const texts = await Promise.all(
          elements.map(el => el.textContent())
        );
        return texts.filter(Boolean);
      `,
      context: {
        url: 'https://example.com',
        selector: 'p',
      },
    }),
  });

  const result = await response.json();
  console.log('Result:', result);
}

async function example6_pdfWithCodeReturningString() {
  console.log('\n=== Example 6: PDF with Code Returning String ===\n');

  const response = await fetch(getUrl('/pdf'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.com',
      code: `
        // Wait for page to load
        await page.waitForLoadState('networkidle');

        // Check if we should generate PDF or return data
        const hasContent = await page.$('h1');
        if (!hasContent) {
          // Return string instead of PDF
          return 'Page has no content!';
        }

        // Otherwise, let it generate PDF normally
      `,
    }),
  });

  const contentType = response.headers.get('content-type');
  if (contentType?.includes('text/plain')) {
    const text = await response.text();
    console.log('Returned string:', text);
  } else if (contentType?.includes('application/pdf')) {
    const buffer = await response.arrayBuffer();
    console.log(`Generated PDF, size: ${buffer.byteLength} bytes`);
  }
}

async function main() {
  try {
    // Check health first
    const healthResponse = await fetch(getUrl('/health'));
    const health = await healthResponse.json();
    console.log('Health check:', health);

    await example1_executeFunction();
    await example2_generatePdf();
    await example3_takeScreenshot();
    await example4_scrapeData();
    await example5_executeWithContext();
    await example6_pdfWithCodeReturningString();

    console.log('\n=== All examples completed! ===\n');
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
