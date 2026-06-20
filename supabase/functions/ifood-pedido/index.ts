// Edge Function: ações no ciclo de vida de um pedido iFood.
// Cobre as etapas 2 a 5 da homologação (confirmar, cancelar, despachar, concluir).
//
// POST JSON: { loja_id, order_id, acao }
//   acao: "confirmar" | "despachar" | "concluir" | "cancelar"
//   (cancelar aceita também { codigo, motivo })

import { admin, ifoodFetch, ORDER } from '../_shared/ifood.ts'
import { atualizarStatusTele } from '../_shared/inserir.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, erro: 'use POST' }, 405)

  try {
    const { loja_id, order_id, acao, codigo, motivo } = await req.json()
    if (!loja_id || !order_id || !acao) {
      return json({ ok: false, erro: 'loja_id, order_id e acao são obrigatórios' }, 400)
    }
    const sb = admin()

    // Cancelar: primeiro CONSULTA os motivos de cancelamento, depois cancela com um motivo válido.
    if (acao === 'cancelar') {
      const rReasons = await ifoodFetch(sb, loja_id, `${ORDER}/orders/${order_id}/cancellationReasons`)
      const reasons = rReasons.ok ? await rReasons.json() : []
      const escolhido = Array.isArray(reasons) && reasons.length
        ? reasons.find((x: any) => /501|sistema|loja|fechad|indispon/i.test(`${x.cancelCodeId} ${x.description}`)) ?? reasons[0]
        : null
      const cancelCode = codigo ?? escolhido?.cancelCodeId ?? '501'
      const reason = motivo ?? escolhido?.description ?? 'Cancelado pela loja'
      const rc = await ifoodFetch(sb, loja_id, `${ORDER}/orders/${order_id}/requestCancellation`, {
        method: 'POST',
        body: JSON.stringify({ reason, cancellationCode: cancelCode }),
      })
      if (!rc.ok && rc.status !== 202) {
        return json({ ok: false, erro: `iFood ${rc.status}: ${await rc.text()}` }, 400)
      }
      await atualizarStatusTele('ifood', order_id, 'cancelado') // remove do pool do garra
      return json({ ok: true, acao, motivos: reasons })
    }

    let path: string
    switch (acao) {
      case 'confirmar': path = `/orders/${order_id}/confirm`; break
      case 'despachar': path = `/orders/${order_id}/dispatch`; break
      case 'concluir': path = `/orders/${order_id}/conclude`; break
      default: return json({ ok: false, erro: `acao inválida: ${acao}` }, 400)
    }

    const r = await ifoodFetch(sb, loja_id, `${ORDER}${path}`, { method: 'POST' })
    if (!r.ok && r.status !== 202) {
      return json({ ok: false, erro: `iFood ${r.status}: ${await r.text()}` }, 400)
    }

    return json({ ok: true, acao })
  } catch (err) {
    return json({ ok: false, erro: String(err) }, 400)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
