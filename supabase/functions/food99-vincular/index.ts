// Edge Function: gera o link de auto-vínculo (self-service) do 99Food.
// O admin chama, recebe a URL e envia pro gerente da loja autorizar nosso app.

import { gerarLinkVinculo } from '../_shared/food99api.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { url, resposta } = await gerarLinkVinculo()
    return json({ ok: Boolean(url), url, resposta })
  } catch (err) {
    return json({ ok: false, erro: String(err) }, 400)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
