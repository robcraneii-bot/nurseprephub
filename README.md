const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.post('/api/chat', async (req, res) => {
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'Set ANTHROPIC_API_KEY in environment variables.' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: req.body.model || 'claude-sonnet-4-20250514', max_tokens: req.body.max_tokens || 1000, system: req.body.system || '', messages: req.body.messages || [] })
    });
    res.json(await response.json());
  } catch (e) { res.status(500).json({ error: 'AI service error' }); }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', tools: 21 }));

app.listen(PORT, () => console.log('NursePrepHub running on port ' + PORT));
