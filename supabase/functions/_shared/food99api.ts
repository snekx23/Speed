// deno-lint-ignore-file no-explicit-any

// Camada de integração com a API 99Food.
//
// A 99Food utiliza duas famílias de endpoints neste projeto:
//
// 1. API legada:
//    https://openapi.99food.com/v1
//
//    Utilizada para:
//    - autenticação;
//    - vínculo da loja;
//    - configuração da loja;
//    - confirmar, pronto e cancelar pedidos.
//
// 2. Open Delivery:
//    https://openapi.99food.com/v4/opendelivery
//
//    Utilizada para:
//    - buscar detalhes do pedido;
//    - despachar pedido;
//    - validar o PIN do cliente;
//    - finalizar entrega.
//
// Nunca converta orderId ou appId para Number, pois podem ultrapassar
// Number.MAX_SAFE_INTEGER.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createHash } from 'node:crypto'

const AUTH_API_BASE =
  Deno.env.get('FOOD99_AUTH_API_BASE') ??
  'https://openapi.99food.com/v1'

const ORDER_API_BASE =
  Deno.env.get('FOOD99_ORDER_API_BASE') ??
  'https://openapi.99food.com/v4/opendelivery'

const BORA_ACAI_LOJA_ID =
  '00000000-0000-0000-0000-000000000001'

const appId = () =>
  String(Deno.env.get('FOOD99_APP_ID') ?? '').trim()

const appSecret = () =>
  String(Deno.env.get('FOOD99_SECRET') ?? '').trim()

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

/**
 * Garante que o app_id seja mantido como texto numérico bruto.
 *
 * Não utilizamos Number ou parseInt para evitar perda de precisão.
 */
function appIdNumerico(): string {
  const value = appId()

  if (!/^\d+$/.test(value)) {
    throw new Error(
      'FOOD99_APP_ID ausente ou inválido. Deve conter somente números.',
    )
  }

  return value
}

/**
 * Monta URLs da API legada da 99Food.
 */
function url99Legacy(path: string): string {
  const cleanBase = AUTH_API_BASE.replace(/\/+$/, '')
  const cleanPath = String(path ?? '').replace(/^\/+/, '')

  if (!cleanPath) {
    throw new Error('Rota legada da 99Food inválida.')
  }

  return `${cleanBase}/${cleanPath}`
}

/**
 * Monta URLs da Open Delivery.
 *
 * Exemplos:
 *
 * construirUrlPedido99Food("123")
 * https://openapi.99food.com/v4/opendelivery/v1/orders/123
 *
 * construirUrlPedido99Food("123", "dispatch")
 * https://openapi.99food.com/v4/opendelivery/v1/orders/123/dispatch
 */
export function construirUrlPedido99Food(
  orderId: string,
  action?: string,
): string {
  const id = String(orderId ?? '').trim()

  if (!id) {
    throw new Error('orderId da 99Food não informado.')
  }

  const cleanBase = ORDER_API_BASE.replace(/\/+$/, '')
  const orderUrl =
    `${cleanBase}/v1/orders/${encodeURIComponent(id)}`

  if (!action) {
    return orderUrl
  }

  const cleanAction = String(action)
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')

  if (!cleanAction) {
    return orderUrl
  }

  return `${orderUrl}/${cleanAction}`
}

function assinar(rawBody: string): string {
  return createHash('md5')
    .update(rawBody + appSecret())
    .digest('hex')
}

/**
 * Remove token e códigos de entrega antes de registrar erros.
 */
function sanitizarBodyLog(rawBody: string): string {
  return String(rawBody ?? '')
    .replace(
      /("auth_token"\s*:\s*)"[^"]*"/gi,
      '$1"***"',
    )
    .replace(
      /("(?:delivery_code|confirmation_code|code)"\s*:\s*)"[^"]*"/gi,
      '$1"***"',
    )
}

/**
 * Limita o tamanho de respostas registradas nos logs.
 */
function limitarTexto(
  value: string,
  maxLength = 1500,
): string {
  const text = String(value ?? '')

  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength)}...[truncado]`
}

/**
 * Lê respostas que podem ser JSON, texto ou corpo vazio.
 */
async function lerResposta(
  response: Response,
): Promise<{
  text: string
  json: any
}> {
  const text = await response.text()

  if (!text) {
    return {
      text: '',
      json: null,
    }
  }

  try {
    return {
      text,
      json: JSON.parse(text),
    }
  } catch {
    return {
      text,
      json: null,
    }
  }
}

/**
 * Faz uma chamada Open Delivery.
 *
 * Quando appShopId for informado e a primeira resposta for 401,
 * renova o token e tenta exatamente mais uma vez.
 */
async function requestOpenDeliveryWithTokenRetry(
  token: string,
  appShopId: string | undefined,
  requestFactory: (currentToken: string) => Promise<Response>,
): Promise<{
  response: Response
  token: string
  tokenRenewed: boolean
}> {
  let currentToken = String(token ?? '').trim()

  if (!currentToken) {
    throw new Error('Token OAuth da 99Food não informado.')
  }

  let response = await requestFactory(currentToken)

  if (
    response.status === 401 &&
    String(appShopId ?? '').trim()
  ) {
    currentToken = await buscarTokenNovo(
      String(appShopId).trim(),
    )

    response = await requestFactory(currentToken)

    return {
      response,
      token: currentToken,
      tokenRenewed: true,
    }
  }

  return {
    response,
    token: currentToken,
    tokenRenewed: false,
  }
}

/**
 * Gera a URL de auto-vínculo.
 *
 * O gerente abre a URL, acessa sua conta 99Food e autoriza o app.
 * A URL normalmente é válida por sete dias.
 */
export async function gerarLinkVinculo(): Promise<{
  url?: string
  resposta: any
}> {
  const raw = `{"app_id":${appIdNumerico()}}`

  const response = await fetch(
    url99Legacy('auth/authorizationpage/getUrl'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'didi-header-sign': assinar(raw),
      },
      body: raw,
    },
  )

  const { text, json } = await lerResposta(response)

  if (!response.ok) {
    console.error('[99Food vínculo] Falha ao gerar link', {
      status: response.status,
      response: limitarTexto(text),
    })
  }

  return {
    url: json?.data?.url,
    resposta: json ?? {
      http_status: response.status,
      raw_response: text,
    },
  }
}

/**
 * Retorna o app_shop_id canônico do Bora Açaí.
 */
export async function obterAppShopIdBoraAcai(): Promise<string> {
  const { data, error } = await admin()
    .from('lojas')
    .select('food99_app_shop_id')
    .eq('id', BORA_ACAI_LOJA_ID)
    .maybeSingle()

  if (error) {
    throw error
  }

  const appShopId = String(
    data?.food99_app_shop_id ??
    Deno.env.get('FOOD99_APP_SHOP_ID') ??
    '',
  ).trim()

  if (!appShopId) {
    throw new Error(
      'Bora Açaí não possui food99_app_shop_id configurado.',
    )
  }

  return appShopId
}

/**
 * Obtém e salva um novo token da loja.
 */
export async function buscarTokenNovo(
  appShopId: string,
): Promise<string> {
  const normalizedAppShopId =
    String(appShopId ?? '').trim()

  if (!normalizedAppShopId) {
    throw new Error('app_shop_id da 99Food não informado.')
  }

  const url = new URL(
    url99Legacy('auth/authtoken/get'),
  )

  url.searchParams.set('app_id', appId())
  url.searchParams.set('app_secret', appSecret())
  url.searchParams.set(
    'app_shop_id',
    normalizedAppShopId,
  )

  const response = await fetch(url.toString())
  const { text, json } = await lerResposta(response)

  const token =
    json?.data?.auth_token ??
    json?.auth_token

  if (!token && Number(json?.errno) === 10101) {
    throw new Error(
      `A autorização da loja não existe para o app_shop_id ${normalizedAppShopId}. ` +
      'Gere um novo link de conexão e autorize a loja novamente no portal 99Food.',
    )
  }

  if (!token) {
    console.error('[99Food token] Falha ao obter token', {
      status: response.status,
      errno: json?.errno,
      errmsg: json?.errmsg,
      response: limitarTexto(text),
    })

    throw new Error(
      `Não foi possível obter o token da 99Food. HTTP ${response.status}.`,
    )
  }

  const { error } = await admin()
    .from('food99_tokens')
    .upsert({
      app_shop_id: normalizedAppShopId,
      auth_token: String(token),
      atualizado_em: new Date().toISOString(),
    })

  if (error) {
    throw error
  }

  return String(token)
}

/**
 * Retorna o token salvo ou busca um novo.
 */
export async function tokenAtual(
  appShopId: string,
): Promise<string> {
  const normalizedAppShopId =
    String(appShopId ?? '').trim()

  if (!normalizedAppShopId) {
    throw new Error('app_shop_id da 99Food não informado.')
  }

  const { data, error } = await admin()
    .from('food99_tokens')
    .select('auth_token')
    .eq('app_shop_id', normalizedAppShopId)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (data?.auth_token) {
    return String(data.auth_token)
  }

  return buscarTokenNovo(normalizedAppShopId)
}

/**
 * Chamada da API legada de pedidos.
 *
 * Mantida apenas para:
 * - confirmar;
 * - pronto;
 * - cancelar.
 *
 * O despacho, PIN e entrega utilizam a Open Delivery.
 */
async function postOrdemLegada(
  appShopId: string,
  path: string,
  orderId: string,
  token: string,
  confirmationCode?: string,
) {
  const nativeOrderId =
    String(orderId ?? '').trim()

  if (!/^\d+$/.test(nativeOrderId)) {
    throw new Error('order_id da 99Food inválido.')
  }

  let raw =
    `{"app_id":${appIdNumerico()}` +
    `,"app_shop_id":${JSON.stringify(String(appShopId))}` +
    `,"auth_token":${JSON.stringify(String(token))}` +
    `,"order_id":${nativeOrderId}`

  if (confirmationCode) {
    const pinStr =
      String(confirmationCode).trim()

    raw +=
      `,"delivery_code":${JSON.stringify(pinStr)}`

    raw +=
      `,"confirmation_code":${JSON.stringify(pinStr)}`

    raw +=
      `,"code":${JSON.stringify(pinStr)}`
  }

  raw += '}'

  const response = await fetch(
    url99Legacy(path),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'didi-header-sign': assinar(raw),
      },
      body: raw,
    },
  )

  const {
    text: responseText,
    json: parsed,
  } = await lerResposta(response)

  if (
    !response.ok ||
    (
      parsed &&
      typeof parsed === 'object' &&
      Number(parsed.errno) !== 0
    )
  ) {
    console.error('[99Food API legada]', {
      path,
      status: response.status,
      errno: parsed?.errno,
      errmsg: parsed?.errmsg,
      response: limitarTexto(responseText),
      body: sanitizarBodyLog(raw),
    })
  }

  if (
    parsed &&
    typeof parsed === 'object'
  ) {
    return {
      ...parsed,
      http_status: response.status,
      raw_response: responseText,
    }
  }

  return {
    errno: response.ok ? 0 : -1,
    errmsg: response.ok
      ? ''
      : (
        responseText ||
        `HTTP ${response.status}`
      ),
    http_status: response.status,
    raw_response: responseText,
  }
}

/**
 * Assinatura por parâmetros para endpoints de loja.
 */
function assinarParams(
  params: Record<string, string | number>,
): string {
  const content = Object.keys(params)
    .filter((key) => {
      return (
        params[key] !== '' &&
        params[key] !== null &&
        params[key] !== undefined
      )
    })
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')

  return createHash('md5')
    .update(content + appSecret())
    .digest('hex')
}

/**
 * Lista as lojas vinculadas ao app.
 */
export async function listarLojasVinculadas(): Promise<any[]> {
  const timestamp = Math.floor(Date.now() / 1000)

  const sign = assinarParams({
    app_id: appId(),
    page_no: 1,
    page_size: 100,
    timestamp,
  })

  const raw =
    `{"app_id":${appIdNumerico()}` +
    `,"timestamp":${timestamp}` +
    `,"sign":"${sign}"` +
    ',"page_no":1' +
    ',"page_size":100}'

  const response = await fetch(
    url99Legacy('shop/shop/list/'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: raw,
    },
  )

  const { text, json } = await lerResposta(response)

  if (!response.ok) {
    console.error('[99Food lojas] Falha ao listar lojas', {
      status: response.status,
      response: limitarTexto(text),
    })

    throw new Error(
      `Erro ao listar lojas vinculadas. HTTP ${response.status}.`,
    )
  }

  return (
    json?.data?.shop_list ??
    json?.data?.shops ??
    []
  )
}

async function buscarLojasVinculadasDoBanco(): Promise<any[]> {
  const { data, error } = await admin()
    .from('lojas')
    .select(
      'nome, food99_app_shop_id, food99_merchant_nome',
    )
    .not('food99_app_shop_id', 'is', null)

  if (error) {
    throw error
  }

  return (data ?? [])
    .filter((loja: any) => {
      return loja?.food99_app_shop_id
    })
    .map((loja: any) => ({
      app_shop_id: loja.food99_app_shop_id,
      shop_name:
        loja.food99_merchant_nome ||
        loja.nome ||
        'Loja 99Food',
      bound_flag: 1,
      source: 'supabase',
    }))
}

async function postShop(
  path: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    url99Legacy(path),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )

  const { text, json } = await lerResposta(response)

  if (!response.ok) {
    console.error('[99Food loja] Erro na configuração', {
      path,
      status: response.status,
      response: limitarTexto(text),
    })

    throw new Error(
      `Erro na configuração da loja. HTTP ${response.status}.`,
    )
  }

  return json
}

/**
 * Configura uma loja para ficar online e utilizar confirmação OpenAPI.
 */
async function configurarLoja(
  appShopId: string,
) {
  const token =
    await buscarTokenNovo(appShopId)

  const online = await postShop(
    'shop/shop/setStatus',
    {
      auth_token: token,
      store_status: 1,
    },
  )

  const confirm = await postShop(
    'shop/shop/setconfirmmethod',
    {
      auth_token: token,
      order_confirm_method: 2,
    },
  )

  return {
    online,
    confirm,
  }
}

/**
 * Configura todas as lojas vinculadas.
 */
export async function configurarLojasVinculadas() {
  const timestamp = Math.floor(Date.now() / 1000)

  const sign = assinarParams({
    app_id: appId(),
    page_no: 1,
    page_size: 100,
    timestamp,
  })

  const raw =
    `{"app_id":${appIdNumerico()}` +
    `,"timestamp":${timestamp}` +
    `,"sign":"${sign}"` +
    ',"page_no":1' +
    ',"page_size":100}'

  let rawResponse: any = null
  let shops: any[] = []

  try {
    const response = await fetch(
      url99Legacy('shop/shop/list/'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: raw,
      },
    )

    const result = await lerResposta(response)

    rawResponse =
      result.json ?? {
        http_status: response.status,
        raw_response: result.text,
      }

    shops =
      result.json?.data?.shop_list ??
      result.json?.data?.shops ??
      []
  } catch (error) {
    rawResponse = {
      error: String(error),
    }
  }

  const lojasConfiguraveis = shops.length
    ? shops
    : await buscarLojasVinculadasDoBanco()

  const resultados: any[] = []
  const supabase = admin()

  const {
    data: boraAcai,
    error: boraAcaiError,
  } = await supabase
    .from('lojas')
    .select('id')
    .eq('id', BORA_ACAI_LOJA_ID)
    .maybeSingle()

  if (boraAcaiError) {
    throw boraAcaiError
  }

  if (!boraAcai) {
    throw new Error(
      'Cadastro canônico do Bora Açaí não encontrado.',
    )
  }

  for (const shop of lojasConfiguraveis) {
    if (Number(shop?.bound_flag) !== 1) {
      continue
    }

    const appShopId = shop?.app_shop_id

    if (!appShopId) {
      resultados.push({
        shop: shop?.shop_name,
        app_shop_id: appShopId,
        erro: 'sem app_shop_id',
      })

      continue
    }

    try {
      const configuration =
        await configurarLoja(String(appShopId))

      const {
        data: byShopId,
        error: byShopIdError,
      } = await supabase
        .from('lojas')
        .select('id')
        .eq(
          'food99_app_shop_id',
          String(appShopId),
        )
        .maybeSingle()

      if (byShopIdError) {
        throw byShopIdError
      }

      if (
        byShopId &&
        byShopId.id !== BORA_ACAI_LOJA_ID
      ) {
        throw new Error(
          'O vínculo 99Food ainda está em um cadastro legado. ' +
          'Aplique a migração de reparo do Bora Açaí.',
        )
      }

      const { error: updateError } = await supabase
        .from('lojas')
        .update({
          food99_app_shop_id:
            String(appShopId),
          food99_merchant_nome:
            shop?.shop_name || 'Bora Açaí',
          status: 'conectada',
        })
        .eq('id', BORA_ACAI_LOJA_ID)

      if (updateError) {
        throw updateError
      }

      resultados.push({
        shop: shop?.shop_name,
        app_shop_id: appShopId,
        ...configuration,
      })
    } catch (error) {
      resultados.push({
        shop: shop?.shop_name,
        app_shop_id: appShopId,
        erro: String(error),
      })
    }
  }

  return {
    total: lojasConfiguraveis.length,
    configuradas: resultados,
    source: shops.length
      ? '99food'
      : 'supabase',
    rawResponse,
    appIdLength: appId().length,
    appSecretLength: appSecret().length,
  }
}

/**
 * Despacha o pedido pela Open Delivery.
 *
 * HTTP 202:
 * solicitação aceita pela 99Food.
 *
 * HTTP 422:
 * não é considerado sucesso automaticamente. O sistema deverá aguardar
 * ou reconciliar o estado pelo webhook.
 */
export async function despacharPedido99Food(
  orderId: string,
  token: string,
  appShopId?: string,
) {
  const url =
    construirUrlPedido99Food(
      orderId,
      'dispatch',
    )

  const {
    response,
    token: tokenUsed,
    tokenRenewed,
  } = await requestOpenDeliveryWithTokenRetry(
    token,
    appShopId,
    (currentToken) => {
      return fetch(url, {
        method: 'POST',
        headers: {
          Authorization:
            `Bearer ${currentToken}`,
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify({}),
      })
    },
  )

  if (response.status === 202) {
    return {
      ok: true,
      accepted: true,
      status: 202,
      token: tokenUsed,
      tokenRenewed,
    }
  }

  const {
    text: responseText,
  } = await lerResposta(response)

  if (response.status === 422) {
    console.warn(
      '[99Food dispatch] Reconciliação necessária',
      {
        orderId,
        status: response.status,
        response: limitarTexto(responseText),
      },
    )

    return {
      ok: false,
      accepted: false,
      status: 422,
      reconciliationRequired: true,
      message:
        'A 99Food não processou novamente o despacho. ' +
        'O estado precisa ser confirmado pelo webhook.',
      token: tokenUsed,
      tokenRenewed,
    }
  }

  console.error('[99Food dispatch] Erro', {
    orderId,
    status: response.status,
    response: limitarTexto(responseText),
  })

  return {
    ok: false,
    accepted: false,
    status: response.status,
    message:
      `Erro ao despachar na 99Food. HTTP ${response.status}.`,
    token: tokenUsed,
    tokenRenewed,
  }
}

/**
 * Valida de forma síncrona o PIN informado pelo cliente.
 *
 * PIN deve permanecer como string para preservar zeros à esquerda.
 */
export async function validarPinEntrega99Food(
  orderId: string,
  pin: string,
  token: string,
  appShopId?: string,
) {
  const deliveryCode =
    String(pin ?? '').trim()

  if (!deliveryCode) {
    return {
      ok: false,
      status: 400,
      message: 'PIN de entrega não informado.',
    }
  }

  const query = new URLSearchParams({
    deliveryCode,
  })

  const url =
    `${construirUrlPedido99Food(
      orderId,
      'validateCode',
    )}?${query.toString()}`

  const {
    response,
    token: tokenUsed,
    tokenRenewed,
  } = await requestOpenDeliveryWithTokenRetry(
    token,
    appShopId,
    (currentToken) => {
      return fetch(url, {
        method: 'POST',
        headers: {
          Authorization:
            `Bearer ${currentToken}`,
        },
      })
    },
  )

  if (response.status === 200) {
    return {
      ok: true,
      status: 200,
      token: tokenUsed,
      tokenRenewed,
    }
  }

  if (response.status === 400) {
    return {
      ok: false,
      status: 400,
      message:
        'PIN informado pelo cliente está incorreto.',
      token: tokenUsed,
      tokenRenewed,
    }
  }

  const {
    text: responseText,
  } = await lerResposta(response)

  console.error('[99Food validateCode] Erro', {
    orderId,
    status: response.status,
    response: limitarTexto(responseText),
  })

  return {
    ok: false,
    status: response.status,
    message:
      `Erro de integração na validação do PIN. HTTP ${response.status}.`,
    token: tokenUsed,
    tokenRenewed,
  }
}

/**
 * Finaliza a entrega pela Open Delivery.
 *
 * Esta função deve ser chamada somente depois de:
 * - PIN válido;
 * - deliveredBy === "MERCHANT";
 * - sendDelivered === true.
 */
export async function finalizarEntrega99Food(
  orderId: string,
  token: string,
  appShopId?: string,
) {
  const url =
    construirUrlPedido99Food(
      orderId,
      'delivered',
    )

  const {
    response,
    token: tokenUsed,
    tokenRenewed,
  } = await requestOpenDeliveryWithTokenRetry(
    token,
    appShopId,
    (currentToken) => {
      return fetch(url, {
        method: 'POST',
        headers: {
          Authorization:
            `Bearer ${currentToken}`,
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify({}),
      })
    },
  )

  if (
    response.status === 202 ||
    response.status === 200
  ) {
    if (response.status === 200) {
      console.warn(
        '[99Food delivered] API retornou HTTP 200 em vez de 202.',
        { orderId },
      )
    }

    return {
      ok: true,
      accepted: true,
      status: response.status,
      token: tokenUsed,
      tokenRenewed,
    }
  }

  const {
    text: responseText,
  } = await lerResposta(response)

  if (response.status === 422) {
    return {
      ok: false,
      accepted: false,
      status: 422,
      reconciliationRequired: true,
      message:
        'A entrega precisa ser reconciliada com o webhook da 99Food.',
      token: tokenUsed,
      tokenRenewed,
    }
  }

  console.error('[99Food delivered] Erro', {
    orderId,
    status: response.status,
    response: limitarTexto(responseText),
  })

  return {
    ok: false,
    accepted: false,
    status: response.status,
    message:
      `Erro ao finalizar entrega na 99Food. HTTP ${response.status}.`,
    token: tokenUsed,
    tokenRenewed,
  }
}

/**
 * Obtém os detalhes atuais do pedido.
 *
 * Evite registrar o objeto completo nos logs, pois pode conter dados pessoais.
 */
export async function obterPedido99Food(
  orderId: string,
  token: string,
  appShopId?: string,
) {
  const url =
    construirUrlPedido99Food(orderId)

  const {
    response,
  } = await requestOpenDeliveryWithTokenRetry(
    token,
    appShopId,
    (currentToken) => {
      return fetch(url, {
        method: 'GET',
        headers: {
          Authorization:
            `Bearer ${currentToken}`,
        },
      })
    },
  )

  if (!response.ok) {
    const {
      text: responseText,
    } = await lerResposta(response)

    console.error('[99Food getOrder] Erro', {
      orderId,
      status: response.status,
      response: limitarTexto(responseText),
    })

    throw new Error(
      `Erro ao obter pedido na 99Food. HTTP ${response.status}.`,
    )
  }

  const {
    json,
  } = await lerResposta(response)

  if (
    !json ||
    typeof json !== 'object'
  ) {
    throw new Error(
      'A 99Food retornou uma resposta inválida ao buscar o pedido.',
    )
  }

  return json
}

/**
 * Mantém compatibilidade com controllers antigos.
 *
 * confirmar, pronto e cancelar:
 * usam a API legada.
 *
 * despachar:
 * usa POST /v1/orders/{orderId}/dispatch.
 *
 * entregue:
 * valida PIN, consulta os detalhes e somente então chama /delivered.
 */
export async function acaoPedido99(
  appShopId: string,
  acao: string,
  orderId: string,
  confirmationCode?: string,
) {
  const normalizedAction =
    String(acao ?? '').trim().toLowerCase()

  if (normalizedAction === 'despachar') {
    const token =
      await tokenAtual(appShopId)

    const result =
      await despacharPedido99Food(
        orderId,
        token,
        appShopId,
      )

    return result.ok
      ? {
        errno: 0,
        errmsg: '',
        http_status: result.status,
        ...result,
      }
      : {
        errno: result.status || -1,
        errmsg:
          result.message ||
          'Falha ao despachar pedido.',
        http_status: result.status,
        ...result,
      }
  }

  if (normalizedAction === 'entregue') {
    const pin =
      String(confirmationCode ?? '').trim()

    if (!pin) {
      return {
        errno: 400,
        errmsg: 'PIN de entrega não informado.',
        http_status: 400,
        ok: false,
      }
    }

    let token =
      await tokenAtual(appShopId)

    const validation =
      await validarPinEntrega99Food(
        orderId,
        pin,
        token,
        appShopId,
      )

    if (!validation.ok) {
      return {
        errno: validation.status || -1,
        errmsg:
          validation.message ||
          'Falha ao validar o PIN.',
        http_status: validation.status,
        ...validation,
      }
    }

    token =
      validation.token ?? token

    const order =
      await obterPedido99Food(
        orderId,
        token,
        appShopId,
      )

    const deliveredBy =
      String(
        order?.delivery?.deliveredBy ?? '',
      ).toUpperCase()

    const sendDelivered =
      order?.sendDelivered === true

    if (
      deliveredBy !== 'MERCHANT' ||
      !sendDelivered
    ) {
      return {
        errno: 0,
        errmsg: '',
        ok: true,
        skipped: true,
        reason:
          deliveredBy !== 'MERCHANT'
            ? 'DELIVERY_NOT_MANAGED_BY_MERCHANT'
            : 'DELIVERED_EVENT_NOT_REQUIRED',
        deliveredBy,
        sendDelivered,
      }
    }

    const result =
      await finalizarEntrega99Food(
        orderId,
        token,
        appShopId,
      )

    return result.ok
      ? {
        errno: 0,
        errmsg: '',
        http_status: result.status,
        ...result,
      }
      : {
        errno: result.status || -1,
        errmsg:
          result.message ||
          'Falha ao finalizar entrega.',
        http_status: result.status,
        ...result,
      }
  }

  const LEGACY_PATHS: Record<string, string> = {
    confirmar: 'order/order/confirm/',
    pronto: 'order/order/ready/',
    cancelar: 'order/order/cancel/',
  }

  const path =
    LEGACY_PATHS[normalizedAction]

  if (!path) {
    throw new Error(
      `Ação inválida: ${normalizedAction}`,
    )
  }

  let token =
    await tokenAtual(appShopId)

  let result =
    await postOrdemLegada(
      appShopId,
      path,
      orderId,
      token,
      confirmationCode,
    )

  if (
    result?.errno === 10100 ||
    result?.errno === 10102
  ) {
    token =
      await buscarTokenNovo(appShopId)

    result =
      await postOrdemLegada(
        appShopId,
        path,
        orderId,
        token,
        confirmationCode,
      )
  }

  return result
}