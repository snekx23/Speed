// Edge Function: setup pós-vínculo do 99Food.
// Lista as lojas vinculadas ao app e, para cada uma, deixa online + confirmação via OpenAPI.

import { configurarLojasVinculadas } from '../_shared/food99api.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const r = await configurarLojasVinculadas()
    return json({ ok: true, ...r })
  } catch (err) {
    return json({ ok: false, erro: String(err) }, 400)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
