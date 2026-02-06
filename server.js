const express = require('express');
const axios = require('axios');
const https = require('https');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Comprehensive keywords for parked/for-sale domains
const parkedKeywords = [
    "domain is for sale", "this domain is parked", "buy this domain",
    "godaddy.com/parked", "hugedomains.com", "is for sale!", 
    "sedo.com", "dan.com", "parking page", "enquire about this domain",
    "domain is available", "domain-is-for-sale"
];

async function checkWebsite(url) {
    let cleanUrl = url.toLowerCase().trim();
    // Ensure protocol
    if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;

    const config = {
        timeout: 12000,
        maxRedirects: 10, // Crucial for Twitter -> X.com
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Referer': 'https://www.google.com/'
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }), // Bypasses SSL issues
        validateStatus: (status) => status < 600 // Don't crash on 403/404
    };

    try {
        const response = await axios.get(cleanUrl, config);
        const html = (response.data || '').toLowerCase();
        const server = (response.headers['server'] || '').toLowerCase();

        // 1. CLOUDFLARE DETECTION (Fix for fashionmag.us)
        // If Cloudflare responds (even with a 403), the server is alive.
        if (server.includes('cloudflare') || html.includes('cf-ray') || html.includes('cloudflare')) {
            return { isUp: true, reason: 'Cloudflare detected' };
        }

        // 2. PARKED DOMAIN DETECTION (Fix for itsviral.net)
        // If the page is small and contains "sale" keywords, it's considered "Down"
        const isParked = parkedKeywords.some(keyword => html.includes(keyword.toLowerCase()));
        if (isParked && html.length < 30000) {
            return { isUp: false, reason: 'Parked Domain' };
        }

        // 3. REDIRECTS & SUCCESS (Fix for twitter.com)
        // If status is 200, 301, 302, or even 404, the server is UP.
        if (response.status >= 200 && response.status < 500) {
            return { isUp: true, reason: `Status ${response.status}` };
        }

        return { isUp: false, reason: `Server returned ${response.status}` };

    } catch (error) {
        // DNS errors, Timeouts, Connection Refused
        return { isUp: false, reason: 'Unreachable' };
    }
}

app.post('/api/check', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    
    const result = await checkWebsite(url);
    
    res.json({
        url: url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
        isUp: result.isUp,
        reason: result.reason
    });
});

app.listen(PORT, () => console.log(`Accuracy Engine active on ${PORT}`));
