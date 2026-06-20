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

const ok = () => Response.json({ errno: 0, errmsg: 'ok' })
const erro = (msg: string, status = 200) => Response.json({ errno: 1, errmsg: msg }, { status })

Deno.serve(async (req) => {
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

  await logWebhook('99food', { type: body?.type }, { 'didi-sign-ok': String(assinaturaOk) })

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
