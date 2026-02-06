const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.static('.'));

app.get('/api/check', async (req, res) => {
    let { domain } = req.query;
    if (!domain) return res.status(400).json({ error: "No domain" });

    // 1. Clean the domain
    domain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

    try {
        // 2. The "Human" Request
        const response = await axios.get(`http://${domain}`, {
            timeout: 10000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            // Important: This stops the server from failing if the SSL is expired
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
            validateStatus: function (status) {
                return status >= 200 && status < 500; // Treat 404 as "Up" but 500 as "Down"
            },
        });

        // 3. The Logic
        // If we got a response and it's not a server crash (500+), it's UP
        res.json({ status: "up", code: response.status });

    } catch (error) {
        // If it completely fails to connect (DNS error or Timeout), it's DOWN
        console.log("Error checking " + domain + ": " + error.message);
        res.json({ status: "down", error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
