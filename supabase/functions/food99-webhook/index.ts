// Edge Function: recebe eventos do 99Food e cria/atualiza a tele no sistema.
//
// AUTENTICAÇÃO (duas camadas; basta uma válida):
//  1) Assinatura oficial: header `didi-header-sign` = MD5(corpoBruto + FOOD99_SECRET).
//  2) Token na URL (?token=...) = WEBHOOK_99FOOD_TOKEN — fallback / testes manuais.
//
// CUIDADOS (doc 99Food):
//  - IDs são inteiros de 64 bits: NÃO usar JSON.parse no order_id (perde precisão).
//    Extraímos o order_id do corpo bruto via regex.
//  - Resposta esperada: { errno: 0, errmsg: "ok" } (senão o 99Food reenvia).
//  - Timeout do callback: 6s.

import { createHash } from 'node:crypto'
import { normalizar99food, tipo99food } from '../_shared/normalizar.ts'
import { inserirTele, atualizarStatusTele, logWebhook } from '../_shared/inserir.ts'
import { acaoPedido99 } from '../_shared/food99api.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ok = () => new Response(JSON.stringify({ errno: 0, errmsg: 'ok' }), {
  status: 200,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
})

const erro = (msg: string, status = 200) => new Response(JSON.stringify({ errno: 1, errmsg: msg }), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method === 'GET' || req.method === 'HEAD') return ok()
  if (req.method !== 'POST') return ok()

  const raw = await req.text()
  let body: any = null
  try {
    body = JSON.parse(raw)
  } catch {
    return ok() // ping de validação sem corpo JSON
  }

  // --- autenticação ---
  const secret = Deno.env.get('FOOD99_SECRET') ?? ''
  const assinaturaRecebida = (req.headers.get('didi-header-sign') ?? '').toLowerCase()
  const assinaturaEsperada = secret ? createHash('md5').update(raw + secret).digest('hex') : ''
  const assinaturaOk = Boolean(assinaturaRecebida) && assinaturaRecebida === assinaturaEsperada

  const url = new URL(req.url)
  const tokenEsperado = Deno.env.get('WEBHOOK_99FOOD_TOKEN')
  const tokenRecebido = url.searchParams.get('token') ?? req.headers.get('x-webhook-token')
  const tokenOk = Boolean(tokenEsperado) && tokenRecebido === tokenEsperado

  if (!assinaturaOk && !tokenOk) return erro('assinatura inválida', 401)

  const requestHeaders: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    requestHeaders[key] = value
  })
  requestHeaders['didi-sign-ok'] = String(assinaturaOk)

  await logWebhook('99food', body, requestHeaders, raw)

  try {
    // order_id de 64 bits: pega exato do corpo bruto (primeira ocorrência = data.order_id).
    const m = raw.match(/"order_id"\s*:\s*"?(\d+)"?/)
    const orderId = m?.[1] ?? String(body?.data?.order_id ?? '')
    if (!orderId) return ok()

    const tipo = tipo99food(body)
    if (tipo === 'novo' || tipo === 'outro') {
      const tele = normalizar99food(body)
      tele.external_id = orderId // garante precisão
      await inserirTele(tele)

      // Fluxo de confirmação automática obrigatório para 99Food
      const shop = tele.food99_app_shop_id || Deno.env.get('FOOD99_APP_SHOP_ID') || 'garra-bora-01'
      try {
        console.log(`Automatic confirmation: confirming order ${orderId} for shop ${shop}...`)
        const confirmRes = await acaoPedido99(shop, 'confirmar', orderId)
        console.log(`Automatic confirmation response:`, confirmRes)
      } catch (confirmErr) {
        console.error(`Automatic confirmation failed for order ${orderId}:`, confirmErr)
      }
    } else if (tipo === 'finalizado') {
      await atualizarStatusTele('99food', orderId, 'entregue')
    } else if (tipo === 'cancelado') {
      await atualizarStatusTele('99food', orderId, 'cancelado')
    }
    return ok()
  } catch (err) {
    return erro(String(err))
  }
})
