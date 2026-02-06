// This runs on Vercel's servers, not in the browser.
export default async function handler(req, res) {
  const { domain } = req.query;
  
  if (!domain) return res.status(400).json({ error: "No domain provided" });

  try {
    // We use a 5-second timeout so the user isn't waiting forever
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`https://${domain}`, { 
      method: 'HEAD', 
      signal: controller.signal 
    });
    
    clearTimeout(id);

    if (response.ok) {
      res.status(200).json({ status: "up", code: response.status });
    } else {
      res.status(200).json({ status: "down", code: response.status });
    }
  } catch (error) {
    res.status(200).json({ status: "down", error: "unreachable" });
  }
}
