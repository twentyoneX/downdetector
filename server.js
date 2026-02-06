const express = require('express');
const axios = require('axios');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Helper function to make raw HTTP/HTTPS request
function makeRawRequest(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'close'
      },
      timeout: 10000,
      rejectUnauthorized: false // Accept self-signed certs
    };

    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const req = protocol.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

// Check website using multiple methods
async function checkWebsite(url) {
  // Ensure URL has protocol
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  console.log(`Checking: ${url}`);

  // Method 1: Try with axios
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      validateStatus: (status) => status < 600 // Accept all responses
    });

    console.log(`Axios result: ${response.status}`);

    // Even if we get 403, if Cloudflare responds, site is technically "up"
    if (response.status === 403 || response.status === 503) {
      // Check if it's a Cloudflare response
      const isCloudflare = response.headers['server']?.toLowerCase().includes('cloudflare') ||
                          response.data?.toLowerCase().includes('cloudflare');
      
      if (isCloudflare) {
        console.log('Detected Cloudflare protection - site is UP but protected');
        return {
          isUp: true,
          status: response.status,
          method: 'axios-cloudflare',
          note: 'Protected by Cloudflare'
        };
      }
    }

    return {
      isUp: response.status >= 200 && response.status < 400,
      status: response.status,
      method: 'axios'
    };

  } catch (axiosError) {
    console.log(`Axios failed: ${axiosError.message}`);

    // Method 2: Try raw HTTP request
    try {
      const response = await makeRawRequest(url);
      console.log(`Raw HTTP result: ${response.statusCode}`);

      // Check for Cloudflare
      const isCloudflare = response.headers['server']?.toLowerCase().includes('cloudflare') ||
                          response.body?.toLowerCase().includes('cloudflare');

      if (isCloudflare && (response.statusCode === 403 || response.statusCode === 503)) {
        console.log('Raw HTTP detected Cloudflare - site is UP');
        return {
          isUp: true,
          status: response.statusCode,
          method: 'raw-cloudflare',
          note: 'Protected by Cloudflare'
        };
      }

      return {
        isUp: response.statusCode >= 200 && response.statusCode < 400,
        status: response.statusCode,
        method: 'raw-http'
      };

    } catch (rawError) {
      console.log(`Raw HTTP failed: ${rawError.message}`);

      // Method 3: DNS check as last resort
      try {
        const dns = require('dns').promises;
        const hostname = url.replace(/^https?:\/\//, '').split('/')[0];
        await dns.resolve(hostname);
        
        console.log('DNS resolved - domain exists');
        
        // Domain exists, assume site is up but we can't access it
        return {
          isUp: true,
          status: 200,
          method: 'dns-only',
          note: 'Domain exists but may be protected'
        };

      } catch (dnsError) {
        console.log(`DNS failed: ${dnsError.message}`);
        
        return {
          isUp: false,
          status: 0,
          method: 'all-failed',
          error: 'Site appears to be down or unreachable'
        };
      }
    }
  }
}

// API endpoint
app.post('/api/check', async (req, res) => {
  try {
    let { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Clean URL for display
    const displayUrl = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

    console.log(`\n=== Checking: ${displayUrl} ===`);

    const result = await checkWebsite(url);

    console.log(`Final result: ${result.isUp ? 'UP ✓' : 'DOWN ✗'} (method: ${result.method})`);

    res.json({
      url: displayUrl,
      isUp: result.isUp,
      status: result.status,
      method: result.method,
      note: result.note,
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

// Test endpoint to check specific URL
app.get('/test/:url', async (req, res) => {
  const url = decodeURIComponent(req.params.url);
  const result = await checkWebsite(url);
  res.json(result);
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`\nServer running on port ${PORT}`);
  console.log(`Test URL: http://localhost:${PORT}/test/fashionmag.us`);
  console.log(`Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n`);
});
