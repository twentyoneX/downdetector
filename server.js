const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

let browser = null;

async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process'
            ]
        });
    }
    return browser;
}

async function checkWebsite(url) {
    if (!url.startsWith('http')) url = 'https://' + url;
    const hostname = url.replace(/^https?:\/\//, '').split('/')[0];

    // STEP 1: Fast Axios Check
    try {
        const response = await axios.get(url, {
            timeout: 8000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            validateStatus: (status) => status < 500
        });

        if (response.status < 400) return { isUp: true, method: 'axios' };
        
        // If 403 but Server is Cloudflare, it's technically UP
        if (response.headers['server']?.toLowerCase().includes('cloudflare')) {
            return { isUp: true, method: 'cloudflare-headers' };
        }
    } catch (e) {
        console.log("Axios failed, moving to Puppeteer...");
    }

    // STEP 2: Puppeteer Check (For sites like fashionmag.us)
    let page;
    try {
        const b = await getBrowser();
        page = await b.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const status = response.status();
        await page.close();

        // Cloudflare returns 403/503 for bots, but if the page loads, it's UP
        return { isUp: status < 500, method: 'puppeteer', status };
    } catch (err) {
        if (page) await page.close();
        return { isUp: false, method: 'failed', error: err.message };
    }
}

app.post('/api/check', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    
    const result = await checkWebsite(url);
    res.json({
        url: url.replace(/^https?:\/\//, '').split('/')[0],
        isUp: result.isUp,
        method: result.method,
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Server on ${PORT}`));
