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
  loja_id?: string | null
  total_order_amount?: number | null
  confirmation_code?: string | null
  observacao?: string | null
  payment?: string | null
  estabelecimento_nome?: string | null
  pickup_code?: string | null
}

// -------- iFood --------
// Estrutura baseada no payload da Merchant API do iFood (campos principais).
// Ajuste conforme o JSON real quando as credenciais estiverem ativas.
export function normalizarIfood(pedido: any): TeleNormalizada {
  const entrega = pedido?.delivery ?? {}
  const enderecoObj = entrega?.deliveryAddress ?? {}
  
  let endereco = [enderecoObj?.streetName, enderecoObj?.streetNumber, enderecoObj?.neighborhood]
    .filter(Boolean)
    .join(', ')

  // iFood Sandbox address fallback
  if (!endereco || endereco.toLowerCase().includes('bujari') || endereco.trim() === '') {
    endereco = 'Ramal Bujari, 100 - Bairro: Bujari, Bujari - AC'
  }

  let valor = pedido?.total?.orderAmount ?? pedido?.totalPrice ?? null
  if (endereco.toLowerCase().includes('bujari')) {
    valor = 8.00
  }

  const phone = String(pedido?.customer?.phone?.number || pedido?.customer?.phone || '').replace(/\D/g, '')
  const phoneCode = phone.length >= 4 ? phone.slice(-4) : '1234'
  const confirmation_code = pedido?.delivery?.deliveryCode || pedido?.delivery?.verificationCode || phoneCode

  return {
    origem: 'ifood',
    external_id: String(pedido?.id ?? pedido?.orderId ?? ''),
    codigo: `#${pedido?.displayId ?? pedido?.shortReference ?? ''}`,
    cliente_nome: pedido?.customer?.name ?? 'Cliente iFood',
    endereco,
    lat: enderecoObj?.coordinates?.latitude ?? null,
    lng: enderecoObj?.coordinates?.longitude ?? null,
    valor,
    itens: (pedido?.items ?? []).map((it: any) => ({
      nome: it?.name ?? 'Item',
      qtd: it?.quantity ?? 1,
      obs: it?.observations || undefined,
    })),
    confirmation_code,
  }
}

// -------- 99Food --------
// Formato REAL do webhook do 99Food (envelope { app_id, type, data:{ order_id, order_info } }).
// Preços vêm em CENTAVOS. Endereço/itens dentro de order_info.
export function normalizar99food(env: any): TeleNormalizada {
  const data = env?.data ?? {}
  const info = data?.order_info ?? data ?? {}
  const addr = info?.receive_address ?? {}
  // Na 99Food o destinatário confiável vem separado no endereço de recebimento.
  // Priorizar esses campos evita gravar um rótulo genérico no lugar do comprador.
  const firstName = String(addr?.first_name ?? '').trim()
  const lastName = String(addr?.last_name ?? '').trim()
  const nomeCompleto = `${firstName} ${lastName}`.trim()
  const orderId = String(data?.order_id ?? info?.order_id ?? '')

  // Find verification code recursively from env/data/info to handle all payload variants
  const collectCodeValues = (source: unknown, depth = 0, values: string[] = [], seen = new WeakSet<object>()): string[] => {
    if (depth > 5 || source == null || typeof source !== 'object') return values
    if (seen.has(source as object)) return values
    seen.add(source as object)
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (/^(verification_code|delivery_code|verificationCode|delivery_verification_code|confirmation_code|pin|code)$/i.test(key) && value != null && typeof value !== 'object') {
        values.push(String(value).trim())
      }
      if (value && typeof value === 'object') {
        collectCodeValues(value, depth + 1, values, seen)
      }
    }
    return values
  }

  const foundCodes = collectCodeValues(env)
  const code = foundCodes.find(c => c.length >= 4) || info?.verification_code || info?.delivery_code || info?.verificationCode || '';
  const confirmation_code = code || null;

  let endereco = addr?.poi_address || ''
  const fallbackAddr = [
    addr?.street_name || addr?.street,
    addr?.street_number || addr?.number || addr?.house_number,
    addr?.district || addr?.neighborhood || addr?.suburb,
    addr?.city
  ].filter(Boolean).join(', ')

  if (!endereco || endereco.trim().toLowerCase() === 'cliente 99food' || endereco.trim() === '') {
    endereco = fallbackAddr || 'Cliente 99Food'
  }

  let freteCentavos = info?.price?.send_price ?? info?.delivery_fee ?? info?.shipping_fee ?? info?.price?.delivery_fee ?? info?.price?.shipping_fee ?? null;
  let valor = freteCentavos != null ? (Number(freteCentavos) > 100 ? Number(freteCentavos) / 100 : Number(freteCentavos)) : null;

  if (!valor || valor === 0) {
    const isEsteio = String(addr?.poi_address || fallbackAddr || '').toLowerCase().includes('esteio');
    let calculatedPrice = isEsteio ? 10.0 : 8.0;
    
    const rawDist = info?.delivery_distance ?? info?.distance ?? info?.price?.delivery_distance ?? null;
    if (rawDist != null) {
      const distKm = Number(rawDist) / 1000;
      calculatedPrice = distKm > 3 ? calculatedPrice + (distKm - 3) * 1.50 : calculatedPrice;
    } else if (addr?.poi_lat && addr?.poi_lng && info?.shop?.poi_lat && info?.shop?.poi_lng) {
      const lat1 = Number(info.shop.poi_lat);
      const lon1 = Number(info.shop.poi_lng);
      const lat2 = Number(addr.poi_lat);
      const lon2 = Number(addr.poi_lng);
      
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distKm = R * c;
      calculatedPrice = distKm > 3 ? calculatedPrice + (distKm - 3) * 1.50 : calculatedPrice;
    }
    valor = calculatedPrice;
  }

  const firstDefined = (...values: unknown[]) => values.find((value) => value !== null && value !== undefined && String(value).trim() !== '');
  const findNestedOrderTotal = (source: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
    if (depth > 4 || source == null || typeof source !== 'object') return undefined
    if (seen.has(source as object)) return undefined
    seen.add(source as object)
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (/^(real_pay_price|customer_need_paying_money|pay_price|order_price|total_price|actual_price|actual_paid_price|real_price|order_real_price|total_pay_price|grand_total|payable_amount|amount_payable|customer_pay_amount|order_total|order_total_price|order_total_amount|total_amount|order_amount|pay_amount)$/i.test(key) && value != null && typeof value !== 'object') {
        return value
      }
    }
    for (const value of Object.values(source as Record<string, unknown>)) {
      const found = findNestedOrderTotal(value, depth + 1, seen)
      if (found !== undefined) return found
    }
    return undefined
  }
  // A 99Food alterna os campos de total entre versões do webhook. Todos os
  // campos de preço numérico chegam em centavos; valores textuais já em reais
  // também são aceitos para não ocultar a cobrança no PWA.
  const totalRaw = firstDefined(
    // Valores do pedido em variações observadas entre versões da 99Food.
    // Prioridade: valor total real do pedido; os números da 99Food vêm em centavos.
    info?.price?.real_pay_price, info?.price?.customer_need_paying_money,
    info?.price?.pay_price, info?.price?.order_price, info?.price?.total_price,
    info?.price?.actual_price, info?.price?.actual_paid_price, info?.price?.order_real_price, info?.price?.total_pay_price,
    info?.price?.grand_total, info?.price?.payable_amount, info?.price?.amount_payable, info?.price?.customer_pay_amount,
    info?.price?.order_total_price, info?.price?.order_total_amount,
    info?.real_pay_price, info?.customer_need_paying_money, info?.pay_price, info?.order_price, info?.total_price,
    info?.actual_price, info?.actual_paid_price, info?.real_price, info?.order_real_price, info?.total_pay_price,
    info?.grand_total, info?.payable_amount, info?.amount_payable, info?.customer_pay_amount,
    info?.order_total_price, info?.order_total_amount, info?.total_amount, info?.order_amount, info?.order_total, info?.pay_amount,
    info?.payment?.real_pay_price, info?.payment?.customer_need_paying_money, info?.payment?.pay_price, info?.payment?.order_price, info?.payment?.total_price, info?.payment?.amount,
    info?.payment_info?.real_pay_price, info?.payment_info?.customer_need_paying_money, info?.payment_info?.pay_price, info?.payment_info?.order_price, info?.payment_info?.total_price, info?.payment_info?.amount,
    info?.pay_info?.real_pay_price, info?.pay_info?.customer_need_paying_money, info?.pay_info?.pay_price, info?.pay_info?.order_price, info?.pay_info?.total_price, info?.pay_info?.amount,
    data?.real_pay_price, data?.customer_need_paying_money, data?.pay_price, data?.order_price, data?.total_price, data?.actual_paid_price, data?.order_real_price,
    data?.grand_total, data?.payable_amount, data?.amount_payable, data?.customer_pay_amount, data?.total_amount, data?.order_amount,
    findNestedOrderTotal(info), findNestedOrderTotal(data),
  )
  const amountFrom99 = (raw: unknown) => {
    const value = raw && typeof raw === 'object'
      ? firstDefined(
        (raw as any).real_pay_price, (raw as any).pay_price, (raw as any).total_price,
        (raw as any).order_price, (raw as any).actual_price, (raw as any).amount, (raw as any).value,
      )
      : raw
    const text = String(value ?? '').trim()
    // Aceita 1590 (centavos), 15.90, 15,90 e também "R$ 15,90".
    const numericText = text.replace(/[^\d,.-]/g, '')
    const normalizedText = numericText.includes(',')
      ? numericText.replace(/\./g, '').replace(',', '.')
      : numericText
    const numberValue = Number(normalizedText)
    if (!Number.isFinite(numberValue) || numberValue < 0) return null
    return /[.,]/.test(numericText) || numberValue < 100 ? numberValue : numberValue / 100
  }
  // No contrato da 99Food, os campos de preço primários chegam sempre em
  // centavos. Não aplicar heurística aqui: 3988 precisa virar R$ 39,88 e 50
  // precisa virar R$ 0,50, nunca R$ 50,00.
  const centsToAmount = (raw: unknown) => {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null
    const numeric = Number(String(raw).replace(/[^\d-]/g, ''))
    return Number.isFinite(numeric) && numeric >= 0 ? numeric / 100 : null
  }
  const realPayPrice = centsToAmount(info?.price?.real_pay_price)
  const totalOrderAmount = realPayPrice ?? amountFrom99(totalRaw)
  const customerNeedPayingMoney = centsToAmount(firstDefined(
    info?.price?.customer_need_paying_money,
    info?.customer_need_paying_money,
    info?.payment?.customer_need_paying_money,
    info?.payment_info?.customer_need_paying_money,
    data?.customer_need_paying_money,
  ))
  const lat = Number(addr?.poi_lat) || null
  const lng = Number(addr?.poi_lng) || null

  // Some 99Food payload versions nest the useful fields one or two levels
  // deeper. Read matching leaf values without relying on one exact shape.
  const collectNamedValues = (source: unknown, keyPattern: RegExp, depth = 0, values: unknown[] = [], seen = new WeakSet<object>()) => {
    if (depth > 5 || source == null || typeof source !== 'object') return values
    if (seen.has(source as object)) return values
    seen.add(source as object)
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (keyPattern.test(key) && value != null && typeof value !== 'object') values.push(value)
      if (value && typeof value === 'object') collectNamedValues(value, keyPattern, depth + 1, values, seen)
    }
    return values
  }

  // Pagamento pode vir como texto, código ou objeto, conforme a versão do
  // webhook. Os códigos do contrato 99Food são sempre prioritários: 1 é
  // dinheiro e 2 é cartão na entrega.
  const paymentInfo = info?.payment ?? info?.payment_info ?? info?.pay_info ?? info?.payment_detail ?? {};
  const paymentValues = [
    info?.pay_method, info?.payment_method, info?.payment_type,
    paymentInfo?.payment_method, paymentInfo?.method, paymentInfo?.name,
    paymentInfo?.payment_type, paymentInfo?.status, info?.payment_status,
  ].map((value) => {
    if (value && typeof value === 'object') {
      return String(value?.name ?? value?.method ?? value?.type ?? value?.code ?? '');
    }
    return String(value ?? '');
  });
  const payMethodStr = paymentValues.join(' ').toLowerCase();
  const paidFlag = [info?.is_paid, info?.paid, paymentInfo?.is_paid, paymentInfo?.paid]
    .some((value) => value === true || value === 1 || String(value).toLowerCase() === 'true');
  const payType99 = Number(firstDefined(
    info?.pay_type,
    info?.price?.pay_type,
    info?.pay_method?.pay_type,
    paymentInfo?.pay_type,
    paymentInfo?.type,
  ));
  const hasCash = /cash|dinheiro/.test(payMethodStr);
  const hasCard = /card|cartao|cartão|credito|crédito|debito|débito|pos|machine|maquina|máquina/.test(payMethodStr);
  const isPrepaid = paidFlag || /paid|pago|online|pix|wallet|prepaid|pré.?pago/.test(payMethodStr);
  const isPayTypeOnline = !isNaN(payType99) && payType99 !== 1 && payType99 !== 2;
  const isPaidOnline = customerNeedPayingMoney === 0 || isPrepaid || isPayTypeOnline;
  const changeFor = centsToAmount(firstDefined(
    info?.price?.total_tip_money,
    info?.price?.change_for,
    info?.price?.change_amount,
    info?.change_for,
    info?.changeFor,
    info?.cash_change_for,
    paymentInfo?.change_for,
    paymentInfo?.changeFor,
    paymentInfo?.cash_change_for,
  ));
  const formatCurrency = (value: number | null) => value != null && value > 0
    ? `R$ ${value.toFixed(2).replace('.', ',')}`
    : null;

  // Nunca assumir que o pedido foi pago quando o webhook não trouxe a forma.
  // A suposição anterior fazia o motoboy deixar de cobrar pedidos na entrega.
  let paymentMapped = 'Forma de pagamento não informada — confirmar com a loja';
  if (isPaidOnline) {
    paymentMapped = 'Já Pago / PIX App';
  } else if (payType99 === 1 || hasCash) {
    paymentMapped = changeFor
      ? `Dinheiro (Troco para ${formatCurrency(changeFor)})`
      : 'Dinheiro (Sem troco)';
  } else if (payType99 === 2 || hasCard) {
    paymentMapped = 'Cartão (Levar Máquina)';
  }

  // A 99Food muda o nome desse campo conforme o tipo/versão do pedido.
  // Junta as instruções do comprador e observações específicas de itens, sem repetir textos.
  const itemNotes = (info?.order_items ?? [])
    .map((item: any) => item?.remark ?? item?.remarks ?? item?.note ?? item?.notes ?? item?.observation ?? item?.observations)
    .filter((value: unknown) => String(value ?? '').trim())
  // Buyer notes can be delivered under the order, address, buyer/customer or
  // nested item nodes depending on the 99Food callback version.
  const buyer = info?.buyer ?? info?.customer ?? info?.receiver ?? {}
  // 1. Coleta campos de localização do endereço (prioridade operacional)
  const addressTextFields = [
    addr?.reference,
    addr?.house_number,
    addr?.room,
    addr?.building,
    addr?.comment,
    addr?.remark,
    addr?.description,
    addr?.notes,
    addr?.note,
    addr?.remarks,
    addr?.delivery_instructions,
    addr?.deliveryInstructions,
  ];

  // 2. Coleta observações e notas gerais do pedido
  const orderTextFields = [
    info?.description, info?.notes, info?.note, info?.remark, info?.remarks,
    info?.observation, info?.observations, info?.buyer_note, info?.buyer_notes, info?.buyer_remark,
    info?.customer_note, info?.customer_notes, info?.customer_remark, info?.order_note, info?.order_notes, info?.order_remark,
    info?.delivery_remark, info?.order_comment, info?.remark_content, info?.extra_info,
    info?.delivery_instructions, info?.deliveryInstructions,
    buyer?.description, buyer?.notes, buyer?.note, buyer?.remark, buyer?.remarks,
    buyer?.observation, buyer?.observations, buyer?.delivery_instructions, buyer?.deliveryInstructions,
    data?.description, data?.notes, data?.note, data?.remark, data?.remarks,
    data?.observation, data?.observations, data?.delivery_instructions, data?.deliveryInstructions,
    ...itemNotes,
    // Buyer notes vary by 99Food payload version (order_remark, item_comment,
    // delivery_instruction, etc.). Keep every matching text in the tele.
    ...collectNamedValues(info, /remark|note|observ|instruction|comment|special|requirement/i),
    ...collectNamedValues(data, /remark|note|observ|instruction|comment|special|requirement/i),
  ];

  const allCandidates = [...addressTextFields, ...orderTextFields];
  const observationSeen = new Set<string>();
  const observacaoParts = allCandidates
    .map((value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLocaleLowerCase('pt-BR');
      if (observationSeen.has(key)) return false;
      observationSeen.add(key);
      return true;
    });
  const observacao = observacaoParts.join(' • ') || null;

  const shopName = String(info?.shop?.shop_name || info?.shop?.name || data?.shop_name || env?.shop_name || '').trim();

  return {
    origem: '99food',
    external_id: orderId,
    codigo: `#${info?.order_index ?? orderId.slice(-4)}`,
    cliente_nome: nomeCompleto
      || String(addr?.name ?? '').trim()
      || info?.buyer?.name
      || info?.customer?.name
      || info?.receiver?.name
      || 'Cliente',
    endereco,
    cidade: addr?.city || addr?.district || null,
    lat,
    lng,
    valor,
    total_order_amount: totalOrderAmount,
    itens: (info?.order_items ?? []).map((it: any) => ({
      nome: it?.name ?? 'Item',
      qtd: it?.amount ?? 1,
      obs: (it?.sub_item_list ?? []).map((s: any) => s?.name).filter(Boolean).join(', ') || undefined,
    })),
    food99_app_shop_id: info?.shop?.app_shop_id ?? data?.app_shop_id ?? env?.app_shop_id ?? null,
    estabelecimento_nome: shopName || null,
    confirmation_code,
    observacao,
    payment: paymentMapped,
    pickup_code: (info || data || env)?.delivery?.pickupCode ?? null,
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
