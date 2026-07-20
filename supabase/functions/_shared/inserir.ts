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

  const shortId = tele.codigo ? tele.codigo.replace('#', '') : tele.external_id.slice(-4)
  const dbId = tele.origem === '99food' ? `99Food #${shortId} (${tele.external_id})` : tele.external_id

  const payload: any = {
    id: dbId,
    client: tele.estabelecimento_nome || loja?.nome || 'Loja',
    dest_name: tele.cliente_nome,
    address: tele.endereco,
    dist: '',
    price: precoTxt,
    payment: tele.payment || `Pago (${origemTxt})`,
    cargo: itensTxt || 'Pedido',
    pickup_lat: loja?.pickup_lat ?? null,
    pickup_lng: loja?.pickup_lng ?? null,
    dest_lat: tele.lat ?? null,
    dest_lng: tele.lng ?? null,
    bidding_started_at: new Date().toISOString(),
    external_id: tele.external_id,
    food99_app_shop_id: tele.food99_app_shop_id ?? null,
    observacao: tele.observacao ?? null,
    pickup_code: tele.pickup_code ?? null,
  }

  if (tele.total_order_amount != null) {
    payload.total_order_amount = `R$ ${Number(tele.total_order_amount).toFixed(2).replace('.', ',')}`
  }

  if (tele.confirmation_code) {
    payload.confirmation_code = tele.confirmation_code
  }

  let { error } = await sb.from('pending_deliveries').upsert(
    payload,
    { onConflict: 'id', ignoreDuplicates: true },
  )

  if (error && error.code === '42703') {
    delete payload.total_order_amount
    delete payload.confirmation_code
    delete payload.external_id
    delete payload.food99_app_shop_id
    delete payload.observacao
    delete payload.pickup_code
    delete payload.dispatch_sent_at
    const { error: retryError } = await sb.from('pending_deliveries').upsert(
      payload,
      { onConflict: 'id', ignoreDuplicates: true },
    )
    error = retryError
  }

  if (error) throw error
}

/** No garra não há status na pending_deliveries: ao cancelar, removemos do pool. */
export async function atualizarStatusTele(origem: string, externalId: string, status: string) {
  if (status !== 'cancelado') return
  if (origem === '99food') {
    await admin()
      .from('pending_deliveries')
      .delete()
      .or(`id.eq.${externalId},id.like.99Food %(${externalId})`)
  } else {
    await admin()
      .from('pending_deliveries')
      .delete()
      .eq('id', externalId)
  }
}

export async function isDuplicateTele(dbId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('pending_deliveries')
    .select('id')
    .eq('id', dbId)
    .maybeSingle()
  return !error && data !== null
}

export async function check99FoodOrderState(orderId: string): Promise<'new' | 'pending' | 'history'> {
  const sb = admin()
  
  // Check client_history (highest priority: once concluded, it is final)
  const { data: history } = await sb
    .from('client_history')
    .select('id')
    .like('id', `99Food %(${orderId})`)
    .limit(1)
    .maybeSingle()
  if (history) return 'history'

  // Check pending_deliveries
  const { data: pending } = await sb
    .from('pending_deliveries')
    .select('id')
    .like('id', `99Food %(${orderId})`)
    .limit(1)
    .maybeSingle()
  if (pending) return 'pending'

  return 'new'
}

/** Refreshes only 99Food metadata from a retry; it never changes rider/status/price. */
export async function atualizarMetadados99Food(tele: any) {
  const shortId = tele.codigo ? tele.codigo.replace('#', '') : tele.external_id.slice(-4)
  const dbId = `99Food #${shortId} (${tele.external_id})`
  const metadata: Record<string, unknown> = {
    external_id: tele.external_id,
    food99_app_shop_id: tele.food99_app_shop_id ?? null,
    payment: tele.payment ?? 'Forma de pagamento nao informada - confirmar com a loja',
  }
  if (tele.total_order_amount != null) {
    metadata.total_order_amount = `R$ ${Number(tele.total_order_amount).toFixed(2).replace('.', ',')}`
  }
  if (tele.observacao) metadata.observacao = tele.observacao
  if (tele.pickup_code) metadata.pickup_code = tele.pickup_code

  const sb = admin()
  // ONLY update pending_deliveries. Never touch client_history!
  const { error } = await sb.from('pending_deliveries').update(metadata).eq('id', dbId)
  if (error) throw error
}
