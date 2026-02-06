const express = require('express');
const axios = require('axios');
const https = require('https');
const http = require('http');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// List of signatures for "Fake/Parked" pages
const parkedSigs = [
    "afternic.com", "sedo.com", "dan.com", "hugedomains.com", 
    "godaddy.com/parked", "domain-for-sale", "parking-page",
    "domain is for sale", "buy this domain", "this domain is parked",
    "is for sale!", "contact the domain owner"
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
        httpAgent: new http.Agent({ rejectUnauthorized: false }),
        validateStatus: (status) => status < 600 
    };

    try {
        const response = await axios.get(cleanUrl, config);
        const finalUrl = (response.request.res.responseUrl || '').toLowerCase();
        const html = (response.data || '').toLowerCase();
        const server = (response.headers['server'] || '').toLowerCase();

        // 1. TWITTER/X/SOCIAL MEDIA TRAP
        // If these sites block the server (403/429), it means the site is ALIVE.
        const isSocial = ["twitter.com", "x.com", "instagram.com", "facebook.com"].some(s => cleanUrl.includes(s));
        if (isSocial && (response.status === 403 || response.status === 429)) {
            return { isUp: true };
        }

        // 2. PARKED DOMAIN TRAP (Fix for itsviral.net)
        // If the URL changed to a parking site, or the text says "Sale"
        const isParked = parkedSigs.some(sig => finalUrl.includes(sig) || html.includes(sig));
        if (isParked && html.length < 60000) {
            return { isUp: false }; // It's "Down" because it's just a parking page
        }

        // 3. CLOUDFLARE TRAP (Fix for fashionmag.us)
        // BUG FIX: Also check all headers for CDN presence
        const hasCDN = server.includes('cloudflare') || html.includes('cf-ray') || 
                       Object.values(response.headers).some(h => String(h).toLowerCase().includes('cloudflare'));
        if (hasCDN) {
            return { isUp: true };
        }

        // 4. NORMAL LOGIC
        // 200-404 range is usually "Up" (The server responded). 500+ is "Down".
        return { isUp: response.status < 500 };

    } catch (error) {
        // BUG FIX: If HTTPS fails, try HTTP before giving up
        if (cleanUrl.startsWith('https://')) {
            try {
                const httpUrl = cleanUrl.replace('https://', 'http://');
                const response = await axios.get(httpUrl, config);
                const finalUrl = (response.request.res.responseUrl || '').toLowerCase();
                const html = (response.data || '').toLowerCase();
                const server = (response.headers['server'] || '').toLowerCase();

                const isSocial = ["twitter.com", "x.com", "instagram.com", "facebook.com"].some(s => httpUrl.includes(s));
                if (isSocial && (response.status === 403 || response.status === 429)) {
                    return { isUp: true };
                }

                const isParked = parkedSigs.some(sig => finalUrl.includes(sig) || html.includes(sig));
                if (isParked && html.length < 60000) {
                    return { isUp: false };
                }

                const hasCDN = server.includes('cloudflare') || html.includes('cf-ray') ||
                               Object.values(response.headers).some(h => String(h).toLowerCase().includes('cloudflare'));
                if (hasCDN) {
                    return { isUp: true };
                }

                return { isUp: response.status < 500 };
            } catch (httpError) {
                return { isUp: false };
            }
        }
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

app.get('/', (req, res) => res.send("System Live"));
app.listen(PORT, () => console.log(`Engine v5 Active`));
