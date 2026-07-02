// Edge Function: setup pós-vínculo do 99Food.
// Lista as lojas vinculadas ao app e, para cada uma, deixa online + confirmação via OpenAPI.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { configurarLojasVinculadas } from '../_shared/food99api.ts'

const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const sb = admin()
    const { data: logs } = await sb
      .from('webhook_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)

    const r = await configurarLojasVinculadas()
    return json({ ok: true, ...r, webhookLogs: logs })
  } catch (err) {
    return json({ ok: false, erro: String(err) }, 400)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
