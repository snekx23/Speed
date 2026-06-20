// Edge Function: envia uma ação de status do pedido para o 99Food.
// POST JSON: { order_id, acao, app_shop_id? }  (acao: confirmar | pronto | entregue | cancelar)
// app_shop_id: usa o do corpo; senão o env FOOD99_APP_SHOP_ID (garra = loja única Borá).

import { acaoPedido99 } from '../_shared/food99api.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, erro: 'use POST' }, 405)

  try {
    const { order_id, acao, app_shop_id } = await req.json()
    if (!order_id || !acao) return json({ ok: false, erro: 'order_id e acao obrigatórios' }, 400)

    const shop = (app_shop_id as string | undefined) || Deno.env.get('FOOD99_APP_SHOP_ID') || 'garra-bora-01'

    const res = await acaoPedido99(shop, acao, String(order_id))
    return json({ ok: res?.errno === 0, resposta: res })
  } catch (err) {
    return json({ ok: false, erro: String(err) }, 400)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
