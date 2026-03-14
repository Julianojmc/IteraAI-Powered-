// api/insights.js
// Vercel serverless function — aggregated knowledge insights + dashboard stats
// Env vars required: SUPABASE_URL, SUPABASE_SERVICE_KEY

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function supabase(method, path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Total entries
    const allEntries = await supabase('GET',
      '/knowledge_entries?select=workflow,sector,eld_level,confidence,created_at,strategies,tags&order=created_at.desc&limit=200'
    );

    // Aggregate in JS (avoids needing Postgres functions beyond basic queries)
    const total = allEntries.length;

    // Workflow breakdown
    const byWorkflow = {};
    const bySector   = {};
    const byEld      = {};
    const stratFreq  = {};
    const recent     = allEntries.slice(0, 5);

    allEntries.forEach(function(e) {
      byWorkflow[e.workflow] = (byWorkflow[e.workflow] || 0) + 1;
      if (e.sector)    bySector[e.sector]     = (bySector[e.sector]   || 0) + 1;
      if (e.eld_level) byEld[e.eld_level]     = (byEld[e.eld_level]   || 0) + 1;
      (e.strategies || []).forEach(function(s) {
        stratFreq[s] = (stratFreq[s] || 0) + 1;
      });
    });

    // Top 10 strategies
    const topStrategies = Object.entries(stratFreq)
      .sort(function(a, b) { return b[1] - a[1]; })
      .slice(0, 10)
      .map(function([strategy, count]) { return { strategy, count }; });

    // Explicit saves vs auto
    const explicitCount = allEntries.filter(function(e) { return e.confidence >= 2; }).length;

    return res.status(200).json({
      total,
      explicit_saves: explicitCount,
      auto_captured:  total - explicitCount,
      by_workflow:    byWorkflow,
      by_sector:      bySector,
      by_eld:         byEld,
      top_strategies: topStrategies,
      recent_entries: recent,
    });

  } catch (err) {
    console.error('GET /api/insights error:', err);
    return res.status(500).json({ error: err.message });
  }
}
