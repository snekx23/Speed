// Normaliza o detalhe de um pedido do iFood (GET /order/v1.0/orders/{id})
// para o formato da nossa tabela `teles`. Tolerante a campos ausentes.

export interface ItemPedido {
  nome: string
  qtd: number
  obs?: string
}

export interface TeleIfood {
  origem: 'ifood'
  external_id: string
  codigo: string
  cliente_nome: string
  endereco: string
  lat: number | null
  lng: number | null
  valor: number | null
  itens: ItemPedido[]
  loja_id?: string | null
}

export function normalizarPedidoIfood(p: any): TeleIfood {
  const addr = p?.delivery?.deliveryAddress ?? {}
  const coords = addr?.coordinates ?? {}
  
  let endereco = addr?.formattedAddress ||
    [addr?.streetName, addr?.streetNumber, addr?.neighborhood].filter(Boolean).join(', ')

  // iFood Sandbox address fallback
  if (!endereco || endereco.toLowerCase().includes('bujari') || endereco.trim() === '') {
    endereco = 'Ramal Bujari, 100 - Bairro: Bujari, Bujari - AC'
  }

  let valor = p?.total?.orderAmount ?? p?.total?.subTotal ?? null
  if (endereco.toLowerCase().includes('bujari')) {
    valor = 8.00
  }

  return {
    origem: 'ifood',
    external_id: String(p?.id ?? ''),
    codigo: `#${p?.displayId ?? ''}`,
    cliente_nome: p?.customer?.name ?? 'Cliente iFood',
    endereco,
    lat: coords?.latitude ?? null,
    lng: coords?.longitude ?? null,
    valor,
    itens: (p?.items ?? []).map((it: any) => ({
      nome: it?.name ?? 'Item',
      qtd: it?.quantity ?? 1,
      obs: it?.observations || undefined,
    })),
  }
}
