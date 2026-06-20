// Edge Function: polling de eventos do iFood (app Distribuído).
//
// Roda a cada ~30s (agendar via cron). Para cada loja conectada:
//   1) GET /events/v1.0/events:polling   (busca eventos novos)
//   2) para eventos de pedido novo (PLACED), busca o detalhe e cria a tele
//   3) POST /events/v1.0/events/acknowledgment  (confirma o recebimento)
//
// Esse polling constante é o que mantém o app "ONLINE" para o iFood.

import { admin, ifoodFetch, EVENTS, ORDER } from '../_shared/ifood.ts'
import { normalizarPedidoIfood } from '../_shared/pedido-ifood.ts'
import { inserirTele, atualizarStatusTele } from '../_shared/inserir.ts'

Deno.serve(async () => {
  const sb = admin()
  const { data: lojas, error } = await sb
    .from('lojas')
    .select('id, ifood_merchant_id')
    .eq('status', 'conectada')
  if (error) return json({ ok: false, erro: String(error) }, 500)

  const resultado: Record<string, unknown> = {}

  for (const loja of lojas ?? []) {
    try {
      resultado[loja.id] = await processarLoja(sb, loja.id, loja.ifood_merchant_id)
    } catch (err) {
      resultado[loja.id] = { erro: String(err) }
    }
  }

  return json({ ok: true, lojas: resultado })
})

async function processarLoja(sb: any, lojaId: string, merchantId: string | null) {
  const headers: Record<string, string> = {}
  if (merchantId) headers['x-polling-merchants'] = merchantId

  const r = await ifoodFetch(sb, lojaId, `${EVENTS}/events:polling`, { headers })
  if (r.status === 204) return { eventos: 0 } // nada novo
  if (!r.ok) throw new Error(`polling ${r.status}: ${await r.text()}`)

  const eventos: any[] = await r.json()
  if (!Array.isArray(eventos) || eventos.length === 0) return { eventos: 0 }

  for (const ev of eventos) {
    const code = (ev.code ?? ev.fullCode ?? '').toString().toUpperCase()
    const orderId = ev.orderId ?? ev.orderID
    if (code === 'PLC' || code === 'PLACED') {
      await criarTeleDoPedido(sb, lojaId, orderId) // pedido novo -> cria a tele
    } else if (orderId) {
      // reflete mudanças de status do iFood na nossa tele
      if (code === 'CON' || code === 'CONCLUDED') await atualizarStatusTele('ifood', orderId, 'entregue')
      else if (code === 'CAN' || code === 'CANCELLED') await atualizarStatusTele('ifood', orderId, 'cancelado')
      else if (code === 'DSP' || code === 'DISPATCHED') await atualizarStatusTele('ifood', orderId, 'em_rota')
    }
  }

  // Confirma TODOS os eventos recebidos (obrigatório).
  const ack = eventos.map((e) => ({ id: e.id }))
  await ifoodFetch(sb, lojaId, `${EVENTS}/events/acknowledgment`, {
    method: 'POST',
    body: JSON.stringify(ack),
  })

  return { eventos: eventos.length }
}

async function criarTeleDoPedido(sb: any, lojaId: string, orderId: string) {
  if (!orderId) return
  const r = await ifoodFetch(sb, lojaId, `${ORDER}/orders/${orderId}`)
  if (!r.ok) throw new Error(`detalhe pedido ${r.status}: ${await r.text()}`)
  const pedido = await r.json()
  const t = normalizarPedidoIfood(pedido)
  // inserirTele enriquece cidade/taxa/loja e deixa o numero (Nº) automático.
  await inserirTele(t)
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}
