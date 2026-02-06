const express = require('express');
const axios = require('axios');
const https = require('https');
const http = require('http');
const cors = require('cors');
const dns = require('dns').promises;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Expanded list of parking page signatures
const parkedSigs = [
    "afternic.com", "sedo.com", "dan.com", "hugedomains.com", 
    "godaddy.com/parked", "domain-for-sale", "parking-page",
    "domain is for sale", "buy this domain", "this domain is parked",
    "is for sale!", "contact the domain owner", "parked free",
    "domain parking", "this page is parked", "domain forwarding"
];

// Common CDN/hosting providers that indicate a working site
const cdnProviders = [
    'cloudflare', 'cf-ray', 'akamai', 'fastly', 'amazon', 
    'cloudfront', 'azure', 'vercel', 'netlify'
];

// Rate limiting map to prevent abuse
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 20;

function checkRateLimit(ip) {
    const now = Date.now();
    const userRequests = rateLimitMap.get(ip) || [];
    const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);
    
    if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
        return false;
    }
    
    recentRequests.push(now);
    rateLimitMap.set(ip, recentRequests);
    return true;
}

// Clean up rate limit map periodically
setInterval(() => {
    const now = Date.now();
    for (const [ip, requests] of rateLimitMap.entries()) {
        const recent = requests.filter(time => now - time < RATE_LIMIT_WINDOW);
        if (recent.length === 0) {
            rateLimitMap.delete(ip);
        } else {
            rateLimitMap.set(ip, recent);
        }
    }
}, RATE_LIMIT_WINDOW);

async function checkDNS(hostname) {
    try {
        await dns.lookup(hostname);
        return true;
    } catch (error) {
        return false;
    }
}

async function checkWebsite(url) {
    let cleanUrl = url.toLowerCase().trim();
    
    // Remove protocol if present
    cleanUrl = cleanUrl.replace(/^https?:\/\//, '');
    // Remove www. prefix
    cleanUrl = cleanUrl.replace(/^www\./, '');
    // Remove path and query params
    cleanUrl = cleanUrl.split('/')[0].split('?')[0];
    
    // Basic validation
    if (!cleanUrl || cleanUrl.length < 3 || !cleanUrl.includes('.')) {
        return { isUp: false, error: 'Invalid domain format' };
    }

    // First check DNS resolution
    const dnsResolved = await checkDNS(cleanUrl);
    if (!dnsResolved) {
        return { isUp: false, error: 'DNS resolution failed - domain does not exist' };
    }

    // Try HTTPS first, then HTTP
    const protocols = ['https://', 'http://'];
    
    for (const protocol of protocols) {
        const testUrl = protocol + cleanUrl;
        
        const config = {
            timeout: 15000,
            maxRedirects: 10,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Upgrade-Insecure-Requests': '1'
            },
            httpsAgent: new https.Agent({ 
                rejectUnauthorized: false,
                timeout: 15000
            }),
            httpAgent: new http.Agent({
                timeout: 15000
            }),
            validateStatus: (status) => status < 600,
            decompress: true
        };

        try {
            const response = await axios.get(testUrl, config);
            const finalUrl = (response.request.res.responseUrl || testUrl).toLowerCase();
            const html = (response.data || '').toLowerCase();
            const server = (response.headers['server'] || '').toLowerCase();
            const status = response.status;

            // 1. SOCIAL MEDIA PLATFORMS - Anti-bot protection is a sign of life
            const socialPlatforms = [
                'twitter.com', 'x.com', 'instagram.com', 'facebook.com',
                'linkedin.com', 'tiktok.com', 'reddit.com', 'pinterest.com'
            ];
            const isSocial = socialPlatforms.some(s => cleanUrl.includes(s));
            
            if (isSocial && (status === 403 || status === 429 || status === 401)) {
                return { isUp: true, note: 'Protected by anti-bot measures (site is up)' };
            }

            // 2. PARKED DOMAIN DETECTION - Enhanced
            const isParked = parkedSigs.some(sig => 
                finalUrl.includes(sig) || html.includes(sig)
            );
            
            // Additional parking indicators
            const parkingIndicators = [
                html.includes('domain') && html.includes('sale'),
                html.includes('buy') && html.includes('domain'),
                html.includes('parked') || html.includes('parking'),
                finalUrl !== testUrl.toLowerCase() && parkedSigs.some(sig => finalUrl.includes(sig))
            ];
            
            const parkingScore = parkingIndicators.filter(Boolean).length;
            
            if (isParked || (parkingScore >= 2 && html.length < 80000)) {
                return { isUp: false, note: 'Domain is parked or for sale' };
            }

            // 3. CDN/HOSTING PROVIDER DETECTION
            const hasCDN = cdnProviders.some(cdn => 
                server.includes(cdn) || 
                html.includes(cdn) ||
                Object.values(response.headers).some(h => 
                    String(h).toLowerCase().includes(cdn)
                )
            );
            
            if (hasCDN) {
                return { isUp: true, note: 'Hosted on active CDN/platform' };
            }

            // 4. STATUS CODE EVALUATION
            // 2xx - Success
            if (status >= 200 && status < 300) {
                return { isUp: true };
            }
            
            // 3xx - Redirects (site is working, just redirecting)
            if (status >= 300 && status < 400) {
                return { isUp: true, note: 'Site redirects but is operational' };
            }
            
            // 4xx - Client errors (except parking indicators)
            // 401, 403 often mean the site is up but requires auth
            if (status === 401 || status === 403) {
                return { isUp: true, note: 'Site requires authentication' };
            }
            
            // 404 means the page doesn't exist, but server is responding
            if (status === 404) {
                return { isUp: true, note: 'Server is up (404 on homepage is unusual)' };
            }
            
            // Other 4xx errors
            if (status >= 400 && status < 500) {
                return { isUp: true, note: 'Server responding with client error' };
            }
            
            // 5xx - Server errors (actual downtime)
            if (status >= 500) {
                return { isUp: false, note: 'Server error (5xx)' };
            }

            // Default - if we got any response, site is technically up
            return { isUp: true };

        } catch (error) {
            // If HTTPS fails, try next protocol (HTTP)
            if (protocol === 'https://') {
                continue;
            }
            
            // Both protocols failed
            const errorMessage = error.message || '';
            
            // Network errors that indicate the site is down
            if (errorMessage.includes('ECONNREFUSED')) {
                return { isUp: false, error: 'Connection refused' };
            }
            if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
                return { isUp: false, error: 'Connection timeout' };
            }
            if (errorMessage.includes('ENOTFOUND')) {
                return { isUp: false, error: 'Domain not found' };
            }
            if (errorMessage.includes('ECONNRESET')) {
                return { isUp: false, error: 'Connection reset' };
            }
            
            // Default error
            return { isUp: false, error: 'Unable to connect' };
        }
    }
    
    // Should never reach here, but just in case
    return { isUp: false, error: 'All connection attempts failed' };
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.post('/api/check', async (req, res) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    
    // Rate limiting
    if (!checkRateLimit(clientIp)) {
        return res.status(429).json({ 
            error: 'Too many requests. Please try again later.',
            isUp: false 
        });
    }
    
    let { url } = req.body;
    
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ 
            error: 'URL required',
            isUp: false 
        });
    }
    
    // Sanitize input
    url = url.trim();
    
    if (url.length > 253) { // Max domain length
        return res.status(400).json({ 
            error: 'URL too long',
            isUp: false 
        });
    }
    
    try {
        const result = await checkWebsite(url);
        const cleanDomain = url
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .split('/')[0]
            .split('?')[0];
        
        res.json({
            url: cleanDomain,
            isUp: result.isUp,
            note: result.note || null,
            error: result.error || null,
            checkedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Check failed:', error);
        res.status(500).json({
            error: 'Internal server error',
            isUp: false
        });
    }
});

app.get('/', (req, res) => {
    res.json({
        name: 'DownDetector API',
        version: '5.0.0',
        status: 'online',
        endpoints: {
            check: 'POST /api/check',
            health: 'GET /health'
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        availableEndpoints: {
            check: 'POST /api/check',
            health: 'GET /health'
        }
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        isUp: false 
    });
});

app.listen(PORT, () => {
    console.log(`✓ DownDetector API v5.0.0 running on port ${PORT}`);
    console.log(`✓ Health check: http://localhost:${PORT}/health`);
});
