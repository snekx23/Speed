// Camada de ENVIO para a OpenAPI do 99Food (status do pedido).
// Doc: base https://openapi.99food.com/v1
//  - GET /auth/authtoken/get?app_id=&app_secret=&app_shop_id=  -> auth_token
//  - POST /order/order/confirm|ready|delivered|cancel  (params: app_id, app_shop_id, auth_token, order_id)
//  - errno 0 = ok; errno 10100 = token expirado -> renova e tenta de novo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createHash } from 'node:crypto'

const BASE = 'https://openapi.99food.com/v1'

function assinar(rawBody: string): string {
  return createHash('md5').update(rawBody + appSecret()).digest('hex')
}

/**
 * Gera a URL de auto-vínculo (self-service binding): o gerente da loja abre,
 * loga no 99Food e autoriza nosso app. URL válida por 7 dias.
 * POST /auth/authorizationpage/getUrl  body {app_id}  (app_id é long -> mantemos string crua p/ precisão)
 */
export async function gerarLinkVinculo(): Promise<{ url?: string; resposta: any }> {
  const raw = `{"app_id":${appId()}}`
  const r = await fetch(`${BASE}/auth/authorizationpage/getUrl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'didi-header-sign': assinar(raw) },
    body: raw,
  })
  const j = await r.json()
  return { url: j?.data?.url, resposta: j }
}

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}
const appId = () => Deno.env.get('FOOD99_APP_ID') ?? ''
const appSecret = () => Deno.env.get('FOOD99_SECRET') ?? ''

async function buscarTokenNovo(appShopId: string): Promise<string> {
  const u = new URL(`${BASE}/auth/authtoken/get`)
  u.searchParams.set('app_id', appId())
  u.searchParams.set('app_secret', appSecret())
  u.searchParams.set('app_shop_id', appShopId)
  const r = await fetch(u.toString())
  const j = await r.json()
  const token = j?.data?.auth_token ?? j?.auth_token
  if (!token && Number(j?.errno) === 10101) {
    throw new Error(
      `auth/get falhou: autorização da loja no 99Food não existe para app_shop_id ${appShopId}. ` +
      'Gere um novo link de conexão e autorize a loja novamente no portal 99Food.',
    )
  }
  if (!token) throw new Error(`auth/get falhou: ${JSON.stringify(j)}`)
  await admin().from('food99_tokens').upsert({
    app_shop_id: appShopId,
    auth_token: token,
    atualizado_em: new Date().toISOString(),
  })
  return token
}

async function tokenAtual(appShopId: string): Promise<string> {
  const { data } = await admin()
    .from('food99_tokens')
    .select('auth_token')
    .eq('app_shop_id', appShopId)
    .maybeSingle()
  if (data?.auth_token) return data.auth_token
  return buscarTokenNovo(appShopId)
}

async function postOrdem(_appShopId: string, path: string, orderId: string, token: string) {
  // Endpoints de pedido autenticam pelo auth_token no corpo (doc 99Food).
  // order_id é 64-bit: enviamos como número cru no JSON p/ não perder precisão.
  const raw = `{"auth_token":"${token}","order_id":${orderId}}`
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  })
  return r.json()
}

// Assinatura por parâmetros (endpoints app-level: List Bind Stores etc.):
// ordena chaves A->Z, junta "k=v" com "&", concatena app_secret, MD5.
function assinarParams(params: Record<string, string | number>): string {
  const str = Object.keys(params)
    .filter((k) => params[k] !== '' && params[k] != null)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return createHash('md5').update(str + appSecret()).digest('hex')
}

/** Lista as lojas vinculadas ao app (POST /shop/shop/list/). */
export async function listarLojasVinculadas(): Promise<any[]> {
  const ts = Math.floor(Date.now() / 1000)
  const sign = assinarParams({ app_id: appId(), page_no: 1, page_size: 100, timestamp: ts })
  // app_id é 64-bit -> número cru no JSON p/ não perder precisão
  const raw = `{"app_id":${appId()},"timestamp":${ts},"sign":"${sign}","page_no":1,"page_size":100}`
  const r = await fetch(`${BASE}/shop/shop/list/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  })
  const j = await r.json()
  return j?.data?.shop_list ?? j?.data?.shops ?? []
}

async function buscarLojasVinculadasDoBanco(): Promise<any[]> {
  const { data, error } = await admin()
    .from('lojas')
    .select('nome, food99_app_shop_id, food99_merchant_nome')
    .not('food99_app_shop_id', 'is', null)

  if (error) throw error

  return (data ?? [])
    .filter((loja: any) => loja?.food99_app_shop_id)
    .map((loja: any) => ({
      app_shop_id: loja.food99_app_shop_id,
      shop_name: loja.food99_merchant_nome || loja.nome || 'Loja 99Food',
      bound_flag: 1,
      source: 'supabase',
    }))
}

async function postShop(path: string, body: Record<string, unknown>) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

/** Configura uma loja: deixa online + confirmação via OpenAPI. */
async function configurarLoja(appShopId: string) {
  const token = await buscarTokenNovo(appShopId)
  const online = await postShop('/shop/shop/setStatus', { auth_token: token, store_status: 1 })
  const confirm = await postShop('/shop/shop/setconfirmmethod', { auth_token: token, order_confirm_method: 2 })
  return { online, confirm }
}

export async function configurarLojasVinculadas() {
  const ts = Math.floor(Date.now() / 1000)
  const sign = assinarParams({ app_id: appId(), page_no: 1, page_size: 100, timestamp: ts })
  const raw = `{"app_id":${appId()},"timestamp":${ts},"sign":"${sign}","page_no":1,"page_size":100}`

  let rawResponse = null
  let shops = []
  try {
    const r = await fetch(`${BASE}/shop/shop/list/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    })
    rawResponse = await r.json()
    shops = rawResponse?.data?.shop_list ?? rawResponse?.data?.shops ?? []
  } catch (err) {
    rawResponse = { error: String(err) }
  }

  const lojasConfiguraveis = shops.length ? shops : await buscarLojasVinculadasDoBanco()
  const resultados: any[] = []
  const sb = admin()
  for (const s of lojasConfiguraveis) {
    if (Number(s?.bound_flag) !== 1) continue
    const appShopId = s?.app_shop_id
    if (!appShopId) {
      resultados.push({ shop: s?.shop_name, app_shop_id: appShopId, erro: 'sem app_shop_id' })
      continue
    }
    try {
      const cfg = await configurarLoja(String(appShopId))

      let existingLoja = null
      const { data: byShopId } = await sb
        .from('lojas')
        .select('id')
        .eq('food99_app_shop_id', String(appShopId))
        .maybeSingle()

      if (byShopId) {
        existingLoja = byShopId
      } else {
        const { data: byName } = await sb
          .from('lojas')
          .select('id')
          .eq('nome', s?.shop_name)
          .maybeSingle()
        existingLoja = byName
      }

      if (existingLoja) {
        await sb
          .from('lojas')
          .update({
            nome: s?.shop_name || 'Nova Loja 99Food',
            food99_app_shop_id: String(appShopId),
            status: 'conectada'
          })
          .eq('id', existingLoja.id)
      } else {
        await sb
          .from('lojas')
          .insert([{
            nome: s?.shop_name || 'Nova Loja 99Food',
            food99_app_shop_id: String(appShopId),
            status: 'conectada'
          }])
      }

      resultados.push({ shop: s?.shop_name, app_shop_id: appShopId, ...cfg })
    } catch (e) {
      resultados.push({ shop: s?.shop_name, app_shop_id: appShopId, erro: String(e) })
    }
  }
  return { 
    total: lojasConfiguraveis.length, 
    configuradas: resultados, 
    source: shops.length ? '99food' : 'supabase',
    rawResponse,
    appIdLength: appId().length,
    appSecretLength: appSecret().length
  }
}

/** Executa uma ação de pedido, renovando o token automaticamente (errno 10100). */
export async function acaoPedido99(appShopId: string, acao: string, orderId: string) {
  const PATHS: Record<string, string> = {
    confirmar: '/order/order/confirm/',
    pronto: '/order/order/ready/',
    entregue: '/order/order/delivered/',
    cancelar: '/order/order/cancel/',
  }
  const path = PATHS[acao]
  if (!path) throw new Error(`ação inválida: ${acao}`)

  let token = await tokenAtual(appShopId)
  let res = await postOrdem(appShopId, path, orderId, token)
  // 10100 = falha ao obter token; 10102 = token expirado -> renova e tenta 1x
  if (res?.errno === 10100 || res?.errno === 10102) {
    token = await buscarTokenNovo(appShopId)
    res = await postOrdem(appShopId, path, orderId, token)
  }
  return res
}
