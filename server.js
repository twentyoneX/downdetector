const express = require('express');
const axios = require('axios');
const https = require('https');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

async function checkWebsite(url) {
    if (!url.startsWith('http')) url = 'https://' + url;
    
    const config = {
        timeout: 10000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        },
        // This is the secret for Render/Cloudflare:
        httpsAgent: new https.Agent({ 
            rejectUnauthorized: false, // Ignore expired SSL
            keepAlive: true 
        }),
        validateStatus: (status) => status < 600 // Don't crash on 403 or 404
    };

    try {
        const response = await axios.get(url, config);

        // LOGIC FOR ACCURACY:
        // 1. If it's 200-399, it's UP.
        if (response.status >= 200 && response.status < 400) return { isUp: true, status: response.status };

        // 2. CLOUDFLARE BYPASS LOGIC:
        // Sites like fashionmag.us return 403 to bots. 
        // If we get a 403, but the server is "cloudflare", it means the server is UP and active!
        const serverHeader = response.headers['server'] || '';
        if (serverHeader.toLowerCase().includes('cloudflare') || response.data.includes('cloudflare')) {
            return { isUp: true, status: response.status, note: "Cloudflare Protected" };
        }

        // 3. If it's 404, the server is UP (it responded), but the page is gone.
        if (response.status === 404) return { isUp: true, status: 404 };

        return { isUp: false, status: response.status };
    } catch (error) {
        // If DNS fails or connection times out, it is definitely DOWN
        return { isUp: false, error: error.message };
    }
}

app.post('/api/check', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    
    const result = await checkWebsite(url);
    res.json({
        url: url.replace(/^https?:\/\//, '').split('/')[0],
        isUp: result.isUp,
        status: result.status || 0,
        note: result.note || "",
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
    console.log(`Render Server Active on Port ${PORT}`);
});
