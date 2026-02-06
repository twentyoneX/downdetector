const express = require('express');
const axios = require('axios');
const https = require('https');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

async function checkWebsite(url) {
    if (!url.startsWith('http')) url = 'https://' + url;
    
    const config = {
        timeout: 8000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        validateStatus: (status) => status < 600 
    };

    try {
        const response = await axios.get(url, config);
        const serverHeader = (response.headers['server'] || '').toLowerCase();
        const dataSnippet = (response.data || '').toLowerCase();

        // 1. SUCCESS: Standard 200-399 response
        if (response.status >= 200 && response.status < 400) return { isUp: true };

        // 2. ACCURACY FIX: Cloudflare/WAF Check
        // If we get a 403/503 but it's clearly Cloudflare, the site is LIVE.
        if (serverHeader.includes('cloudflare') || dataSnippet.includes('cloudflare')) {
            return { isUp: true, note: "Cloudflare Active" };
        }

        // 3. PAGE MISSING: 404 means the server is UP, but that specific page is gone.
        if (response.status === 404) return { isUp: true };

        return { isUp: false };
    } catch (error) {
        return { isUp: false };
    }
}

app.post('/api/check', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const result = await checkWebsite(url);
    res.json({
        url: url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
        isUp: result.isUp
    });
});

app.listen(PORT, () => console.log(`Checker active on port ${PORT}`));
