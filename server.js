const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Browser instance management
let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });
  }
  return browser;
}

// Method 1: Puppeteer (Best for Cloudflare)
async function checkWithPuppeteer(url) {
  let page;
  try {
    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();
    
    // Set realistic headers
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Extra headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    });
    
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    
    const status = response.status();
    await page.close();
    
    return {
      isUp: status >= 200 && status < 400,
      status: status,
      method: 'puppeteer'
    };
    
  } catch (error) {
    if (page) await page.close();
    return {
      isUp: false,
      status: 0,
      error: error.message,
      method: 'puppeteer'
    };
  }
}

// Method 2: Axios with enhanced headers (fallback)
async function checkWithAxios(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      },
      validateStatus: function (status) {
        return status < 500;
      }
    });
    
    return {
      isUp: response.status >= 200 && response.status < 400,
      status: response.status,
      method: 'axios'
    };
    
  } catch (error) {
    if (error.response) {
      return {
        isUp: false,
        status: error.response.status,
        error: error.message,
        method: 'axios'
      };
    }
    return {
      isUp: false,
      status: 0,
      error: error.message,
      method: 'axios'
    };
  }
}

// Smart check function - tries multiple methods
async function smartCheck(url) {
  // Clean URL
  url = url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  // Try axios first (faster)
  const axiosResult = await checkWithAxios(url);
  
  // If axios fails with 403, 503, or shows cloudflare protection, use puppeteer
  if (!axiosResult.isUp && (axiosResult.status === 403 || axiosResult.status === 503 || axiosResult.status === 0)) {
    console.log(`Axios failed for ${url}, trying Puppeteer...`);
    return await checkWithPuppeteer(url);
  }
  
  return axiosResult;
}

// API endpoint
app.post('/api/check', async (req, res) => {
  try {
    let { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    // Remove protocol and www for consistency
    url = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    
    console.log(`Checking: ${url}`);
    
    const result = await smartCheck(url);
    
    res.json({
      url: url,
      isUp: result.isUp,
      status: result.status,
      method: result.method,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: 'Failed to check website',
      message: error.message
    });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cleanup on shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
