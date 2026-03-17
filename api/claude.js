/**
 * IteraAI Knowledge-Grounded Proxy
 * /api/claude.js — v3: web search enabled
 *
 * CHANGE FROM v2: Added 'anthropic-beta: web-search-2025-03-05' header.
 * Everything else is identical to your original.
 */

export const config = { runtime: 'edge' };

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const ITERAAI_SYSTEM_BASE = `You are IteraAI, an expert AI assistant for California CTE (Career and Technical Education) educators who serve multilingual and multicultural classrooms.

Your knowledge is grounded in official California and federal education policy, standards, and research. When generating instructional materials, prompts, or guidance:

1. ALWAYS align to CA CTE Model Curriculum Standards (15 industry sectors, 11 Foundation Standards, Standards for Career Ready Practice)
2. ALWAYS embed CA ELD Standards (2012) — reference Emerging/Expanding/Bridging proficiency levels, Integrated and Designated ELD
3. ALWAYS apply Perkins V requirements when relevant — equity for special populations, program quality, accountability indicators
4. ALWAYS reference LCAP/LCFF priorities when generating district-level documents — especially Priority 2 (Implementation of Standards), Priority 4 (Pupil Achievement), Priority 7 (Course Access), Priority 8 (Other Pupil Outcomes)
5. APPLY SIOP/SDAIE principles — Content Objectives + Language Objectives, comprehensible input, interaction, building background, review/assessment
6. INCLUDE Title III awareness — EL program requirements, reclassification criteria, supplement not supplant
7. HONOR student identities — immigrant, refugee, DACA, Indigenous, multilingual — use affirming, asset-based language throughout

When citing standards or policy, use precise language (e.g., "CA ELD Standard 9–10.I.B.6" or "Perkins V Section 134(b)(5)").
When you are unsure of a specific code number, say "per CA CTE Foundation Standards" rather than inventing a citation.

IMPORTANT: You are a tool for educators. Be specific, practical, and grounded. Avoid generic advice.`;

function getClientId(request) {
  const ua = request.headers.get('user-agent') || '';
  const lang = request.headers.get('accept-language') || '';
  let h = 0;
  for (const c of ua + lang) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36).padStart(6, '0');
}

function excerpt(text, max = 300) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function lastUserMessage(messages) {
  if (!Array.isArray(messages)) return '';
  const user = [...messages].reverse().find(m => m.role === 'user');
  if (!user) return '';
  if (typeof user.content === 'string') return user.content;
  if (Array.isArray(user.content)) {
    return user.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
  }
  return '';
}

async function retrieveContext(query, supabaseUrl, supabaseKey) {
  if (!supabaseUrl || !supabaseKey || !query) return '';
  try {
    const embedRes = await fetch(`${supabaseUrl}/functions/v1/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
      body: JSON.stringify({ input: query }),
    });
    if (!embedRes.ok) return '';
    const { embedding } = await embedRes.json();

    const searchRes = await fetch(`${supabaseUrl}/rest/v1/rpc/match_documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ query_embedding: embedding, match_threshold: 0.7, match_count: 5 }),
    });
    if (!searchRes.ok) return '';
    const chunks = await searchRes.json();
    if (!chunks || chunks.length === 0) return '';

    const contextBlock = chunks
      .map(chunk => `[SOURCE: ${chunk.source_name} | ${chunk.section}]\n${chunk.content}`)
      .join('\n\n---\n\n');

    return `\n\n## RETRIEVED POLICY & STANDARDS CONTEXT\nThe following official excerpts are relevant to this request. Use them to ground your response:\n\n${contextBlock}\n\n## END RETRIEVED CONTEXT\n`;
  } catch {
    return '';
  }
}

const requestCounts = new Map();

function isRateLimited(clientId) {
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = 20;
  const entry = requestCounts.get(clientId) || { count: 0, windowStart: now };
  if (now - entry.windowStart > windowMs) {
    requestCounts.set(clientId, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= maxRequests) return true;
  entry.count++;
  requestCounts.set(clientId, entry);
  return false;
}

const BLOCKED_PATTERNS = [
  /\b(ssn|social security|credit card number|password)\b/i,
  /\b(harm|hurt|abuse)\s+(student|child|minor)\b/i,
];

function isSafeContent(text) {
  return !BLOCKED_PATTERNS.some(p => p.test(text));
}

async function logToSheets(payload) {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch {}
}

async function logToSupabase(payload) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/iteraai_logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': `Bearer ${key}`, 'Prefer': 'return=minimal' },
      body: JSON.stringify(payload),
    });
  } catch {}
}

export default async function handler(request) {
  const ts = new Date().toISOString();
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body;
  try { body = await request.json(); }
  catch {
    return new Response(JSON.stringify({ error: { message: 'Invalid JSON' } }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const clientId = getClientId(request);
  const origin = request.headers.get('origin') || 'unknown';

  if (isRateLimited(clientId)) {
    Promise.all([
      logToSheets({ ts, clientId, origin, event: 'rate_limited' }),
      logToSupabase({ ts, client_id: clientId, origin, event: 'rate_limited' }),
    ]).catch(() => {});
    return new Response(JSON.stringify({ error: { message: 'Too many requests. Please wait a moment.' } }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userText = lastUserMessage(body.messages);
  if (!isSafeContent(userText)) {
    Promise.all([
      logToSheets({ ts, clientId, origin, event: 'blocked_content', prompt_excerpt: excerpt(userText) }),
      logToSupabase({ ts, client_id: clientId, origin, event: 'blocked_content', prompt_excerpt: excerpt(userText) }),
    ]).catch(() => {});
    return new Response(JSON.stringify({ error: { message: 'Request could not be processed.' } }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: { message: 'Service not configured.' } }), {
      status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const ragContext = await retrieveContext(
    userText,
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const baseSystem = body.system || ITERAAI_SYSTEM_BASE;
  const enrichedSystem = baseSystem + ragContext;

  // Spread full body — tools, model, messages, max_tokens all pass through untouched
  const anthropicBody = { ...body, system: enrichedSystem };

  let anthropicRes;
  try {
    anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'web-search-2025-03-05', // ← ONLY CHANGE FROM v2: enables CARL web search
      },
      body: JSON.stringify(anthropicBody),
    });
  } catch {
    return new Response(JSON.stringify({ error: { message: 'Upstream connection error.' } }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const responseData = await anthropicRes.json();
  const responseText = responseData?.content?.[0]?.text || '';
  const inputTokens = responseData?.usage?.input_tokens || 0;
  const outputTokens = responseData?.usage?.output_tokens || 0;

  const logEntry = {
    ts, client_id: clientId, origin, event: 'generation',
    model: body.model || 'unknown',
    has_system: !!body.system,
    rag_chunks_injected: ragContext ? 1 : 0,
    prompt_excerpt: excerpt(userText, 300),
    response_excerpt: excerpt(responseText, 300),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    status: anthropicRes.status,
  };

  Promise.all([logToSheets(logEntry), logToSupabase(logEntry)]).catch(() => {});

  return new Response(JSON.stringify(responseData), {
    status: anthropicRes.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
