// api/runs.js — Workflow History: save + retrieve
// ENV required: SUPABASE_URL, SUPABASE_SERVICE_KEY

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sb(method, path, body) {
  const r = await fetch(`${SB_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST /api/runs — save a completed workflow run
  if (req.method === 'POST') {
    try {
      const {
        workflow_type, run_title, sector, eld_level,
        inputs_json, outputs_json, preview_text,
        source_file_summary, user_id
      } = req.body;

      if (!workflow_type) return res.status(400).json({ error: 'workflow_type required' });

      const row = await sb('POST', '/workflow_runs', {
        workflow_type,
        run_title:           run_title           || null,
        sector:              sector              || null,
        eld_level:           eld_level           || null,
        inputs_json:         inputs_json         || null,
        outputs_json:        outputs_json        || null,
        preview_text:        preview_text        || null,
        source_file_summary: source_file_summary || null,
        user_id:             user_id             || null,
      });

      return res.status(201).json({ success: true, id: row[0]?.id });
    } catch (err) {
      console.error('POST /api/runs:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // GET /api/runs — retrieve recent runs
  if (req.method === 'GET') {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const type  = req.query.workflow_type;
      const filter = type ? `&workflow_type=eq.${encodeURIComponent(type)}` : '';
      const rows = await sb('GET',
        `/workflow_runs?order=created_at.desc&limit=${limit}${filter}&select=id,workflow_type,run_title,sector,eld_level,preview_text,source_file_summary,created_at,outputs_json`
      );
      return res.status(200).json({ runs: rows });
    } catch (err) {
      console.error('GET /api/runs:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
