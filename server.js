const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (all your HTML tools)
app.use(express.static(path.join(__dirname, 'public')));

// ── AI PROXY ENDPOINT ──
// This keeps your API key secret on the server
app.post('/api/chat', async (req, res) => {
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  
  if (!API_KEY) {
    return res.status(500).json({ error: 'API key not configured. Set ANTHROPIC_API_KEY in environment variables.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: req.body.model || 'claude-sonnet-4-20250514',
        max_tokens: req.body.max_tokens || 1000,
        system: req.body.system || '',
        messages: req.body.messages || []
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('AI proxy error:', error);
    res.status(500).json({ error: 'Failed to reach AI service' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', tools: 21, version: '1.0.0' });
});

// Catch-all: serve index.html for any unmatched route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🏥 NursePrepHub running on port ${PORT}`);
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   → AI proxy: ${process.env.ANTHROPIC_API_KEY ? 'ACTIVE ✓' : 'NO KEY — set ANTHROPIC_API_KEY'}`);
});
