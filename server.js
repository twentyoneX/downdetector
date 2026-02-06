const express = require('express');
const axios = require('axios');
const https = require('https');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// If a site redirects to these, it is "DOWN" (Parked)
const parkingDestinations = [
    "afternic.com", "sedo.com", "dan.com", "hugedomains.com", 
    "godaddy.com/parked", "domain-for-sale", "parking-page"
];

// Keywords in the HTML that mean "DOWN"
const parkedKeywords = [
    "domain is for sale", "buy this domain", "this domain is parked",
    "is for sale!", "contact the domain owner", "sedo.com", "dan.com"
];

async function checkWebsite(url) {
    let cleanUrl = url.toLowerCase().trim();
    if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;

    const config = {
        timeout: 10000,
        maxRedirects: 10,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Referer': 'https://www.google.com/'
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        validateStatus: (status) => status < 600 
    };

    try {
        const response = await axios.get(cleanUrl, config);
        const finalUrl = response.request.res.responseUrl || '';
        const html = (response.data || '').toLowerCase();
        const server = (response.headers['server'] || '').toLowerCase();

        // 1. TRAP FOR TWITTER/X (Handling Bot Blocks)
        // If we get a 403 or 429 from Twitter/X/Instagram, it's actually UP.
        if (response.status === 403 || response.status === 429) {
            if (cleanUrl.includes("twitter.com") || cleanUrl.includes("x.com") || cleanUrl.includes("instagram.com")) {
                return { isUp: true, reason: 'Social media block (Site is Up)' };
            }
        }

        // 2. TRAP FOR PARKED DOMAINS (Fix for itsviral.net)
        // Check if the final destination URL is a parking service
        const isParkedUrl = parkingDestinations.some(d => finalUrl.toLowerCase().includes(d));
        // Check if the HTML contains "For Sale" keywords
        const hasParkedContent = parkedKeywords.some(k => html.includes(k));
        
        // If it's small (parked pages are usually tiny) and has parking signals
        if ((isParkedUrl || hasParkedContent) && html.length < 50000) {
            return { isUp: false, reason: 'Parked Domain' };
        }

        // 3. CLOUDFLARE CHECK (Fix for fashionmag.us)
        if (server.includes('cloudflare') || html.includes('cloudflare')) {
            return { isUp: true };
        }

        // 4. STANDARD SUCCESS
        // If we reached a destination and status is good
        if (response.status >= 200 && response.status < 400) {
            return { isUp: true };
        }

        return { isUp: false };
    } catch (error) {
        return { isUp: false, reason: 'Connection failed' };
    }
}

app.post('/api/check', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    
    const result = await checkWebsite(url);
    res.json({
        url: url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
        isUp: result.isUp
    });
});

app.listen(PORT, () => console.log(`Accuracy Engine v4 active on ${PORT}`));
