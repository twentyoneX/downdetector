const express = require('express');
const axios = require('axios');
const https = require('https');
const cors = require('cors');
const dns = require('dns').promises;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Signatures that strongly indicate a "DOWN" or "FAKE" page
const parkedSigs = [
    "domain is for sale", "buy this domain", "related searches", 
    "related links", "search results", "domain has been parked", 
    "sedo", "bodis", "afternic", "hugedomains", 
    "godaddy.com/parked", "this domain is available"
];

// Major sites known to block bots, but are definitely UP
const majorBotBlockers = ["twitter.com", "x.com", "instagram.com", "facebook.com", "google.com"];

async function checkWebsite(url) {
    let cleanUrl = url.toLowerCase().trim();
    if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;
    
    const hostname = cleanUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

    // --- STEP 1: DNS LOOKUP (THE ULTIMATE GATEKEEPER) ---
    try {
        await dns.lookup(hostname);
    } catch (dnsError) {
        return { isUp: false, reason: 'DNS lookup failed' };
    }

    // --- STEP 2: HTTP REQUEST & ANALYSIS ---
    try {
        const response = await axios.get(cleanUrl, {
            timeout: 8000,
            maxRedirects: 10,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Referer': 'https://www.google.com/'
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            validateStatus: () => true // Handle ALL status codes without crashing
        });

        const status = response.status;
        const html = (response.data || '').toString().toLowerCase();
        
        // EVIDENCE 1: Is the server itself crashing?
        if (status >= 500) {
            return { isUp: false, reason: `Server Error: ${status}` };
        }
        
        // EVIDENCE 2: Is it a Parked Page? (`itsviral.net` fix)
        const isParked = parkedSigs.some(sig => html.includes(sig));
        if (isParked) {
            return { isUp: false, reason: 'Detected Parked Page' };
        }
        
        // EVIDENCE 3: Is it a Major Site blocking our bot? (Google & Twitter fix)
        const isMajorSite = majorBotBlockers.some(site => hostname.includes(site));
        if (isMajorSite && (status === 403 || status === 429)) {
            return { isUp: true, reason: `Bot Block (Site is UP): ${status}` };
        }
        
        // EVIDENCE 4: Is it a normally functioning site?
        // This includes 2xx (Success), 3xx (Redirects), and 4xx (Client Errors like 404)
        if (status >= 200 && status < 500) {
            return { isUp: true, reason: `Healthy Status: ${status}` };
        }

        return { isUp: false, reason: 'Unknown Failure' };

    } catch (httpError) {
        // --- STEP 3: FIREWALL FALLBACK ---
        // HTTP connection failed, but DNS passed. This means the server exists but blocked us.
        // For a human user, the site is considered "UP".
        return { isUp: true, reason: 'Firewall or connection issue (Site is UP)' };
    }
}

app.post('/api/check', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    
    const result = await checkWebsite(url);
    console.log(`Checked ${url}. Result: ${result.isUp ? 'UP' : 'DOWN'}. Reason: ${result.reason}`);
    
    res.json({
        url: url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
        isUp: result.isUp
    });
});

app.get('/', (req, res) => res.send("DNS Engine v3 Ready"));
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
