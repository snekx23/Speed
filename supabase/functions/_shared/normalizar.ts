// Camada de normalização: cada plataforma (iFood, 99Food) tem um formato
// diferente de pedido. Aqui convertemos para o formato único da tabela `teles`.

export interface TeleNormalizada {
  origem: 'ifood' | '99food'
  external_id: string
  codigo: string
  cliente_nome: string
  endereco: string
  cidade?: string | null
  lat: number | null
  lng: number | null
  valor: number | null
  itens: { nome: string; qtd: number; obs?: string }[]
  food99_app_shop_id?: string | null
}

// -------- iFood --------
// Estrutura baseada no payload da Merchant API do iFood (campos principais).
// Ajuste conforme o JSON real quando as credenciais estiverem ativas.
export function normalizarIfood(pedido: any): TeleNormalizada {
  const entrega = pedido?.delivery ?? {}
  const endereco = entrega?.deliveryAddress ?? {}
  return {
    origem: 'ifood',
    external_id: String(pedido?.id ?? pedido?.orderId ?? ''),
    codigo: `#${pedido?.displayId ?? pedido?.shortReference ?? ''}`,
    cliente_nome: pedido?.customer?.name ?? 'Cliente iFood',
    endereco: [endereco?.streetName, endereco?.streetNumber, endereco?.neighborhood]
      .filter(Boolean)
      .join(', '),
    lat: endereco?.coordinates?.latitude ?? null,
    lng: endereco?.coordinates?.longitude ?? null,
    valor: pedido?.total?.orderAmount ?? pedido?.totalPrice ?? null,
    itens: (pedido?.items ?? []).map((it: any) => ({
      nome: it?.name ?? 'Item',
      qtd: it?.quantity ?? 1,
      obs: it?.observations || undefined,
    })),
  }
}

// -------- 99Food --------
// Formato REAL do webhook do 99Food (envelope { app_id, type, data:{ order_id, order_info } }).
// Preços vêm em CENTAVOS. Endereço/itens dentro de order_info.
export function normalizar99food(env: any): TeleNormalizada {
  const data = env?.data ?? {}
  const info = data?.order_info ?? data ?? {}
  const addr = info?.receive_address ?? {}
  const orderId = String(data?.order_id ?? info?.order_id ?? '')

  const endereco =
    addr?.poi_address ||
    [addr?.street_name, addr?.street_number, addr?.district, addr?.city].filter(Boolean).join(', ')

  const centavos = info?.price?.order_price ?? info?.price?.real_pay_price
  const lat = Number(addr?.poi_lat) || null
  const lng = Number(addr?.poi_lng) || null

  return {
    origem: '99food',
    external_id: orderId,
    codigo: `#${info?.order_index ?? orderId.slice(-4)}`,
    cliente_nome: addr?.name || [addr?.first_name, addr?.last_name].filter(Boolean).join(' ') || 'Cliente 99Food',
    endereco,
    cidade: addr?.city || addr?.district || null,
    lat,
    lng,
    valor: centavos != null ? Number(centavos) / 100 : null,
    itens: (info?.order_items ?? []).map((it: any) => ({
      nome: it?.name ?? 'Item',
      qtd: it?.amount ?? 1,
      obs: (it?.sub_item_list ?? []).map((s: any) => s?.name).filter(Boolean).join(', ') || undefined,
    })),
    food99_app_shop_id: info?.shop?.app_shop_id ?? data?.app_shop_id ?? env?.app_shop_id ?? null,
  }
}

/** Tipo do evento: orderNew | (finalizado) | (cancelado). */
export function tipo99food(env: any): 'novo' | 'finalizado' | 'cancelado' | 'outro' {
  const t = String(env?.type ?? '').toLowerCase()
  if (t.includes('new')) return 'novo'
  if (t.includes('cancel')) return 'cancelado'
  if (t.includes('finish') || t.includes('complete') || t.includes('final')) return 'finalizado'
  return 'outro'
}
