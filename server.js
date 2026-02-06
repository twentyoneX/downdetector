const express = require('express');
const axios = require('axios');
const https = require('https');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// If the URL redirects to these, the site is technically "DOWN" (Parked/For Sale)
const parkingDestinations = ["afternic.com", "sedo.com", "dan.com", "hugedomains.com", "godaddy.com/parked", "domain-for-sale", "parking-page"];

// Keywords that mean a site is "DOWN" or "PARKED"
const parkedKeywords = ["domain is for sale", "buy this domain", "this domain is parked", "is for sale!", "sedo.com", "dan.com"];

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
        const finalUrl = (response.request.res.responseUrl || '').toLowerCase();
        const html = (response.data || '').toLowerCase();
        const server = (response.headers['server'] || '').toLowerCase();

        // TRAP 1: Social Media (Twitter/X/Instagram)
        // These sites block data centers. If we get 403/429 from them, the site is actually UP.
        if (response.status === 403 || response.status === 429) {
            if (cleanUrl.includes("twitter.com") || cleanUrl.includes("x.com") || cleanUrl.includes("instagram.com") || cleanUrl.includes("facebook.com")) {
                return { isUp: true };
            }
        }

        // TRAP 2: Parked Domains (itsviral.net)
        // If it points to a parking site, or the text says "For Sale", it's DOWN.
        const isParkedUrl = parkingDestinations.some(d => finalUrl.includes(d));
        const hasParkedContent = parkedKeywords.some(k => html.includes(k));
        
        if (isParkedUrl || (hasParkedContent && html.length < 50000)) {
            return { isUp: false };
        }

        // TRAP 3: Cloudflare (fashionmag.us)
        // If Cloudflare answers, the site is UP.
        if (server.includes('cloudflare') || html.includes('cloudflare')) {
            return { isUp: true };
        }

        // TRAP 4: Normal Status Check
        // 200-399 = UP. 404 = UP (Server works). 500+ = DOWN.
        if (response.status >= 200 && response.status < 500) {
            return { isUp: true };
        }

        return { isUp: false };

    } catch (error) {
        // Totally dead (DNS fail or timeout)
        return { isUp: false };
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

app.get('/', (req, res) => res.send("API ACTIVE"));
app.listen(PORT, () => console.log(`Engine Ready`));
