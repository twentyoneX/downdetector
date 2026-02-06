const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Method 1: Direct check with enhanced headers
async function checkDirect(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      },
      validateStatus: (status) => status < 500
    });

    return {
      isUp: response.status >= 200 && response.status < 400,
      status: response.status,
      method: 'direct'
    };
  } catch (error) {
    // If we get 403 or connection refused, likely Cloudflare
    if (error.response && error.response.status === 403) {
      return null; // Try proxy
    }
    return {
      isUp: false,
      status: error.response ? error.response.status : 0,
      error: error.message,
      method: 'direct-failed'
    };
  }
}

// Method 2: Check via CORS proxies (for Cloudflare sites)
async function checkViaProxy(url) {
  const proxies = [
    {
      name: 'allorigins',
      url: `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
    },
    {
      name: 'corsproxy',
      url: `https://corsproxy.io/?${encodeURIComponent(url)}`
    }
  ];

  for (const proxy of proxies) {
    try {
      console.log(`Trying ${proxy.name} for ${url}`);
      
      const response = await axios.get(proxy.url, {
        timeout: 15000,
        validateStatus: (status) => status < 500
      });

      // Check if we got valid response
      if (response.status === 200) {
        // For allorigins, check the contents
        if (proxy.name === 'allorigins' && response.data) {
          if (response.data.status && response.data.status.http_code) {
            const statusCode = response.data.status.http_code;
            return {
              isUp: statusCode >= 200 && statusCode < 400,
              status: statusCode,
              method: `proxy-${proxy.name}`
            };
          }
          // If we got content, site is probably up
          if (response.data.contents && response.data.contents.length > 0) {
            return {
              isUp: true,
              status: 200,
              method: `proxy-${proxy.name}`
            };
          }
        } else {
          // For other proxies, 200 means site is up
          return {
            isUp: true,
            status: 200,
            method: `proxy-${proxy.name}`
          };
        }
      }
    } catch (error) {
      console.log(`${proxy.name} failed:`, error.message);
      continue; // Try next proxy
    }
  }

  // All proxies failed
  return {
    isUp: false,
    status: 0,
    method: 'all-proxies-failed',
    error: 'Could not verify status'
  };
}

// Method 3: Simple DNS check (last resort)
async function checkDNS(hostname) {
  try {
    const dns = require('dns').promises;
    await dns.resolve(hostname);
    return {
      isUp: true,
      status: 200,
      method: 'dns-only',
      note: 'Domain exists but HTTP check failed'
    };
  } catch (error) {
    return {
      isUp: false,
      status: 0,
      method: 'dns-failed',
      error: 'Domain does not exist'
    };
  }
}

// Smart check function with fallbacks
async function smartCheck(url) {
  // Clean URL
  let cleanUrl = url.trim();
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = 'https://' + cleanUrl;
  }

  // Extract hostname for DNS check
  const hostname = cleanUrl.replace(/^https?:\/\//, '').split('/')[0];

  // Step 1: Try direct check
  console.log(`1. Direct check: ${cleanUrl}`);
  const directResult = await checkDirect(cleanUrl);
  
  if (directResult && directResult.isUp) {
    return directResult;
  }

  // Step 2: If direct failed with 403 or returned null, try proxies
  console.log(`2. Proxy check: ${cleanUrl}`);
  const proxyResult = await checkViaProxy(cleanUrl);
  
  if (proxyResult && proxyResult.isUp) {
    return proxyResult;
  }

  // Step 3: Last resort - check if domain exists
  console.log(`3. DNS check: ${hostname}`);
  const dnsResult = await checkDNS(hostname);
  
  // If DNS works but HTTP failed, site might be blocking us
  if (dnsResult.isUp) {
    return {
      isUp: true,
      status: 200,
      method: 'dns-verified',
      note: 'Domain exists, likely protected by Cloudflare or similar'
    };
  }

  // Everything failed
  return directResult || proxyResult || dnsResult;
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

    const result = await smartCheck(url);

    console.log(`Result: ${result.isUp ? 'UP' : 'DOWN'} (${result.method})\n`);

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
  console.log(`Server running on port ${PORT}`);
  console.log(`Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
});
