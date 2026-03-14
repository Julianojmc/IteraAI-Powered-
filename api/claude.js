// api/claude.js
// Vercel serverless proxy for Anthropic API
// Handles: plain text, system prompts, multipart content (PDF/images)
// Env var required: ANTHROPIC_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const { model, max_tokens, system, messages } = req.body;

    if (!messages || !messages.length) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const body = {
      model:      model      || 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 2000,
      messages,
    };

    // Include system prompt if provided
    if (system) body.system = system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(response.status).json({ error: data.error || data });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('api/claude.js error:', err);
    return res.status(500).json({ error: err.message });
  }
}
