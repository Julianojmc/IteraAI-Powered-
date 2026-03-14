// api/knowledge.js
// Vercel serverless function — save and query IteraAI knowledge entries
// Env vars required: SUPABASE_URL, SUPABASE_SERVICE_KEY

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Supabase helper (no SDK needed — pure fetch) ──────────────────────────
async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer':        method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

// ── CORS headers ──────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Main handler ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── POST /api/knowledge — save a new entry ────────────────────────────
  if (req.method === 'POST') {
    try {
      const {
        workflow, source = 'auto', confidence = 1,
        sector, eld_level, grade_level, disability,
        college_partner, course_name, topic, population,
        inputs_json, ai_insight, tags = [], strategies = [],
        rating, teacher_note
      } = req.body;

      if (!workflow || !ai_insight) {
        return res.status(400).json({ error: 'workflow and ai_insight are required' });
      }

      const entry = await supabase('POST', '/knowledge_entries', {
        workflow, source, confidence,
        sector:          sector          || null,
        eld_level:       eld_level       || null,
        grade_level:     grade_level     || null,
        disability:      disability      || null,
        college_partner: college_partner || null,
        course_name:     course_name     || null,
        topic:           topic           || null,
        population:      population      || null,
        inputs_json:     inputs_json     || null,
        ai_insight,
        tags,
        strategies,
        rating:          rating          || null,
        teacher_note:    teacher_note    || null,
      });

      return res.status(201).json({ success: true, entry: entry[0] });

    } catch (err) {
      console.error('POST /api/knowledge error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET /api/knowledge — query relevant entries ───────────────────────
  if (req.method === 'GET') {
    try {
      const { workflow, sector, eld_level, disability, college_partner, limit = 6 } = req.query;

      // Build Supabase filter string — match on available fields, ordered by confidence
      const filters = [];
      if (workflow)        filters.push(`workflow=eq.${encodeURIComponent(workflow)}`);
      if (sector)          filters.push(`sector=ilike.*${encodeURIComponent(sector)}*`);
      if (eld_level)       filters.push(`eld_level=ilike.*${encodeURIComponent(eld_level)}*`);
      if (disability)      filters.push(`disability=ilike.*${encodeURIComponent(disability)}*`);
      if (college_partner) filters.push(`college_partner=ilike.*${encodeURIComponent(college_partner)}*`);

      const filterStr = filters.length ? filters.join('&') : '';
      const url = `/knowledge_entries?${filterStr}&order=confidence.desc,created_at.desc&limit=${limit}&select=ai_insight,strategies,tags,confidence,sector,eld_level,workflow`;

      const entries = await supabase('GET', url);
      return res.status(200).json({ entries });

    } catch (err) {
      console.error('GET /api/knowledge error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
