const express = require('express');
const axios = require('axios');
const https = require('https');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Keywords that indicate a site is actually "Down" or "Parked"
const parkedKeywords = [
    "domain is for sale", 
    "this domain is parked", 
    "buy this domain", 
    "godaddy.com/parked", 
    "hugeDomains.com",
    "is for sale!"
];

async function checkWebsite(url) {
    // Clean and lowercase
    let cleanUrl = url.toLowerCase().trim();
    if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;
    
    const config = {
        timeout: 10000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        validateStatus: (status) => status < 600 
    };

    try {
        const response = await axios.get(cleanUrl, config);
        const html = (response.data || '').toLowerCase();
        const server = (response.headers['server'] || '').toLowerCase();

        // 1. Check for Cloudflare (Always counts as UP)
        if (server.includes('cloudflare') || html.includes('cloudflare')) {
            return { isUp: true };
        }

        // 2. Check for "Parked/For Sale" content (Accuracy Fix)
        const isParked = parkedKeywords.some(keyword => html.includes(keyword.toLowerCase()));
        if (isParked) {
            return { isUp: false, note: "Domain Parked" };
        }

        // 3. Standard Status Check
        if (response.status >= 200 && response.status < 400) {
            return { isUp: true };
        }

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
        url: url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
        isUp: result.isUp
    });
});

app.listen(PORT, () => console.log(`Accuracy Pro active on ${PORT}`));
