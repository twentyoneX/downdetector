const express = require('express');
const axios = require('axios');
const https = require('https');
const cors = require('cors');
const dns = require('dns').promises;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());



const parkedSignatures = [
    "domain is for sale", "buy this domain", "related searches", 
    "related links", "search results", "provider of this page", 
    "domain has been parked", "sedo", "bodis", "afternic", 
    "hugeDomains", "godaddy.com/parked", "this domain is available"
];

async function checkWebsite(url) {
    let cleanUrl = url.toLowerCase().trim();
    if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;
    
    // Extract hostname for DNS check
    const hostname = cleanUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

    // STEP 1: DNS CHECK (The Ultimate Truth)
    try {
        await dns.lookup(hostname);
        // If this passes, the domain EXISTS.
    } catch (dnsError) {
        return { isUp: false }; // Domain doesn't exist or no IP found.
    }

    // STEP 2: HTTP CONTENT CHECK
    try {
        const response = await axios.get(cleanUrl, {
            timeout: 5000, // Short timeout
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html'
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            validateStatus: (status) => status < 600
        });

        const html = (response.data || '').toString().toLowerCase();
        const title = html.match(/<title>(.*?)<\/title>/)?.[1] || "";

        // CHECK FOR FAKE/PARKED PAGE
        // Parked pages often have the domain name as the Title and generic links
        const isParkedContent = parkedSignatures.some(sig => html.includes(sig));
        
        // Specific logic for "itsviral.net" style pages
        if (isParkedContent || title.includes(hostname) && html.length < 15000) {
            return { isUp: false }; // It's technically "up" but it's a fake/parked page.
        }

        // If we got here, it's a real site sending a 200 OK.
        return { isUp: true };

    } catch (httpError) {
        // STEP 3: FIREWALL FALLBACK
        // If HTTP failed (timeout/403/429) BUT DNS passed (Step 1), 
        // it means the server exists but is blocking our bot.
        // Therefore, it is UP for humans.
        return { isUp: true };
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

app.get('/', (req, res) => res.send("DNS Engine Ready"));
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
