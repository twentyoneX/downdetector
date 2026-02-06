const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Enhanced check with multiple fallback methods
async function checkWebsite(url) {
  // Clean URL
  url = url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  // Method 1: Full GET request with browser headers
  try {
    const response = await axios.get(url, {
      timeout: 12000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'DNT': '1',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"'
      },
      validateStatus: function (status) {
        return status < 500; // Accept anything below 500
      }
    });

    return {
      isUp: response.status >= 200 && response.status < 400,
      status: response.status,
      method: 'axios-full'
    };

  } catch (error) {
    // Method 2: Try HEAD request (lighter)
    try {
      const headResponse = await axios.head(url, {
        timeout: 8000,
        maxRedirects: 3,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        validateStatus: function (status) {
          return status < 500;
        }
      });

      return {
        isUp: headResponse.status >= 200 && headResponse.status < 400,
        status: headResponse.status,
        method: 'axios-head'
      };

    } catch (headError) {
      // Method 3: Try without HTTPS (fallback to HTTP)
      if (url.startsWith('https://')) {
        try {
          const httpUrl = url.replace('https://', 'http://');
          const httpResponse = await axios.get(httpUrl, {
            timeout: 8000,
            maxRedirects: 3,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            validateStatus: function (status) {
              return status < 500;
            }
          });

          return {
            isUp: httpResponse.status >= 200 && httpResponse.status < 400,
            status: httpResponse.status,
            method: 'axios-http'
          };

        } catch (httpError) {
          // All methods failed
          return {
            isUp: false,
            status: 0,
            error: httpError.message,
            method: 'failed'
          };
        }
      }

      // Return the original error
      if (headError.response) {
        return {
          isUp: false,
          status: headError.response.status,
          error: headError.message,
          method: 'error'
        };
      }

      return {
        isUp: false,
        status: 0,
        error: headError.message,
        method: 'error'
      };
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

    // Remove protocol and www for consistency
    const cleanUrl = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

    console.log(`Checking: ${cleanUrl}`);

    const result = await checkWebsite(cleanUrl);

    res.json({
      url: cleanUrl,
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
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage()
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
});
