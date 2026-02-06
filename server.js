const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// This serves your index.html file to visitors
app.use(express.static('.')); 

// This is your Backend API
app.get('/api/check', async (req, res) => {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ error: "Missing domain" });

    // Sanitize domain
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

    try {
        // The server pings the website
        const response = await axios.get(`https://${cleanDomain}`, { timeout: 8000 });
        res.json({ status: "up", code: response.status });
    } catch (error) {
        res.json({ status: "down", error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
