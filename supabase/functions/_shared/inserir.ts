import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { TeleNormalizada } from './normalizar.ts'

// >>> ADAPTADO PARA O APP "garra" (tabela pending_deliveries / modelo de leilão) <<<
// Pedidos do iFood/99Food entram no pool de entregas (pending_deliveries).

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

const ORIGEM_LABEL: Record<string, string> = { ifood: 'iFood', '99food': '99Food', manual: 'Manual' }

export async function logWebhook(origem: string, payload: unknown, headers?: Record<string, string>, raw?: string) {
  try {
    await admin().from('webhook_logs').insert({ origem, payload, headers: headers ?? null, raw: raw ?? null })
  } catch (_) { /* log não pode quebrar o webhook */ }
}

/** Insere o pedido no pool de entregas do garra (pending_deliveries). */
export async function inserirTele(tele: TeleNormalizada) {
  const sb = admin()
  let loja = null
  if (tele.loja_id) {
    const { data } = await sb
      .from('lojas')
      .select('id, nome, pickup_lat, pickup_lng')
      .eq('id', tele.loja_id)
      .maybeSingle()
    loja = data
  } else if (tele.origem === '99food' && tele.food99_app_shop_id) {
    const { data } = await sb
      .from('lojas')
      .select('id, nome, pickup_lat, pickup_lng')
      .eq('food99_app_shop_id', tele.food99_app_shop_id)
      .maybeSingle()
    loja = data
  }

  if (!loja) {
    const { data: lojas } = await sb
      .from('lojas')
      .select('id, nome, pickup_lat, pickup_lng')
      .order('created_at')
      .limit(1)
    loja = lojas?.[0] ?? null
  }

  if (loja?.id && tele.food99_app_shop_id) {
    await sb
      .from('lojas')
      .update({
        food99_app_shop_id: tele.food99_app_shop_id,
        status: 'conectada',
      })
      .eq('id', loja.id)
  }

  const itensTxt = (tele.itens ?? []).map((i) => `${i.qtd}x ${i.nome}`).join(', ')
  const precoTxt = tele.valor != null ? `R$ ${Number(tele.valor).toFixed(2).replace('.', ',')}` : ''
  const origemTxt = ORIGEM_LABEL[tele.origem] ?? tele.origem

  const { error } = await sb.from('pending_deliveries').upsert(
    {
      id: tele.external_id,
      client: loja?.nome ?? 'Loja',
      dest_name: tele.cliente_nome,
      address: tele.endereco,
      dist: '',
      price: precoTxt,
      payment: `Pago (${origemTxt})`,
      cargo: itensTxt || 'Pedido',
      pickup_lat: loja?.pickup_lat ?? null,
      pickup_lng: loja?.pickup_lng ?? null,
      dest_lat: tele.lat ?? null,
      dest_lng: tele.lng ?? null,
      bidding_started_at: new Date().toISOString(),
    },
    { onConflict: 'id', ignoreDuplicates: true },
  )
  if (error) throw error
}

/** No garra não há status na pending_deliveries: ao cancelar, removemos do pool. */
export async function atualizarStatusTele(_origem: string, externalId: string, status: string) {
  if (status !== 'cancelado') return
  await admin().from('pending_deliveries').delete().eq('id', externalId)
}
