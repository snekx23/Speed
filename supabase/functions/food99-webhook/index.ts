// deno-lint-ignore-file no-explicit-any

// Edge Function: recebe eventos da 99Food e cria/atualiza
// as entregas no sistema.
//
// AUTENTICAÇÃO:
// 1. didi-header-sign = MD5(corpo bruto + FOOD99_SECRET)
// 2. ?token=WEBHOOK_99FOOD_TOKEN para fallback/testes.
//
// IMPORTANTE:
// Os IDs da 99Food podem ultrapassar Number.MAX_SAFE_INTEGER.
// O orderId sempre é extraído diretamente do corpo bruto e
// mantido como string.

import { createHash } from 'node:crypto'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import {
  normalizar99food,
  tipo99food,
} from '../_shared/normalizar.ts'

import {
  atualizarMetadados99Food,
  atualizarStatusTele,
  check99FoodOrderState,
  inserirTele,
  logWebhook,
} from '../_shared/inserir.ts'

import {
  acaoPedido99,
  obterAppShopIdBoraAcai,
} from '../_shared/food99api.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-request-id, x-webhook-token, didi-header-sign',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
}

type SupabaseAdmin = any

type SyncEvent =
  | 'dispatch'
  | 'delivered'

/*
 * Eventos confirmados pelo padrão Open Delivery e aliases
 * defensivos utilizados por integrações proprietárias.
 *
 * Eventos desconhecidos são registrados nos logs e ignorados
 * com resposta HTTP 200, evitando criar pedidos duplicados.
 */
const NEW_EVENTS = new Set([
  'ORDER_NEW',
  'CREATED',
])

const DISPATCH_EVENTS = new Set([
  'DISPATCHED',
  'ORDER_DISPATCHED',
])

const DELIVERED_EVENTS = new Set([
  'DELIVERED',
  'CONCLUDED',
  'ORDER_DELIVERED',
  'ORDER_CONCLUDED',
  'ORDER_FINISHED',
])

const CANCELLED_EVENTS = new Set([
  'CANCELLED',
  'CANCELED',
  'ORDER_CANCELLED',
  'ORDER_CANCELED',
])

function admin(): SupabaseAdmin {
  const supabaseUrl =
    Deno.env.get('SUPABASE_URL')

  const serviceRoleKey =
    Deno.env.get(
      'SUPABASE_SERVICE_ROLE_KEY',
    )

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    throw new Error(
      'Variáveis do Supabase não configuradas.',
    )
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
  )
}

function ok(): Response {
  return new Response(
    JSON.stringify({
      errno: 0,
      errmsg: 'ok',
    }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type':
          'application/json; charset=utf-8',
      },
    },
  )
}

function erro(
  message: string,
  status = 200,
): Response {
  return new Response(
    JSON.stringify({
      errno: 1,
      errmsg: message,
    }),
    {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type':
          'application/json; charset=utf-8',
      },
    },
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  /*
   * Permite validações simples realizadas pela plataforma.
   */
  if (
    req.method === 'GET' ||
    req.method === 'HEAD'
  ) {
    return ok()
  }

  /*
   * Evita gerar erro para chamadas inesperadas.
   */
  if (req.method !== 'POST') {
    return ok()
  }

  const raw = await req.text()

  let body: any = null

  try {
    body = JSON.parse(raw)
  } catch {
    /*
     * Algumas validações da plataforma podem não enviar
     * um JSON de pedido.
     */
    return ok()
  }

  /*
   * Autenticação por assinatura oficial.
   */
  const secret =
    Deno.env.get('FOOD99_SECRET') ?? ''

  const receivedSignature =
    String(
      req.headers.get(
        'didi-header-sign',
      ) ?? '',
    )
      .trim()
      .toLowerCase()

  const expectedSignature =
    secret
      ? createHash('md5')
        .update(raw + secret)
        .digest('hex')
        .toLowerCase()
      : ''

  const signatureValid =
    Boolean(receivedSignature) &&
    Boolean(expectedSignature) &&
    receivedSignature ===
      expectedSignature

  /*
   * Fallback por token para testes e compatibilidade.
   */
  const requestUrl =
    new URL(req.url)

  const expectedToken =
    Deno.env.get(
      'WEBHOOK_99FOOD_TOKEN',
    )

  const receivedToken =
    requestUrl.searchParams.get(
      'token',
    ) ??
    req.headers.get(
      'x-webhook-token',
    )

  const tokenValid =
    Boolean(expectedToken) &&
    receivedToken === expectedToken

  if (
    !signatureValid &&
    !tokenValid
  ) {
    return erro(
      'assinatura inválida',
      401,
    )
  }

  /*
   * Registra os headers sem alterar o corpo original.
   */
  const requestHeaders:
    Record<string, string> = {}

  req.headers.forEach(
    (value, key) => {
      requestHeaders[key] = value
    },
  )

  requestHeaders[
    'didi-sign-ok'
  ] = String(signatureValid)

  await logWebhook(
    '99food',
    body,
    requestHeaders,
    raw,
  )

  try {
    /*
     * Sempre extrai o ID diretamente do corpo bruto.
     *
     * Não utiliza Number, parseInt ou o valor numérico
     * produzido pelo JSON.parse.
     */
    const orderId =
      extrairOrderId(raw, body)

    if (!orderId) {
      console.warn(
        '[99Food webhook] Evento sem orderId',
        {
          eventType:
            extrairEventType(raw, body),
        },
      )

      return ok()
    }

    const eventType =
      extrairEventType(raw, body)

    const normalizedEvent =
      normalizarEventType(eventType)

    const tipo =
      tipo99food(body)

    console.log(
      '[99Food webhook] Evento recebido',
      {
        orderId,
        eventType:
          normalizedEvent || null,
        tipo,
      },
    )

    /*
     * Confirmação de despacho.
     *
     * Deve ocorrer antes de qualquer outro tratamento
     * para impedir que o evento seja interpretado como
     * um pedido novo.
     */
    if (
      DISPATCH_EVENTS.has(
        normalizedEvent,
      )
    ) {
      await confirmarSincronizacao(
        orderId,
        'dispatch',
        normalizedEvent,
      )

      return ok()
    }

    /*
     * Confirmação de entrega/conclusão.
     *
     * Atualizamos os campos operacionais antes de
     * mover a entrega para o histórico.
     */
    if (
      DELIVERED_EVENTS.has(
        normalizedEvent,
      ) ||
      tipo === 'finalizado'
    ) {
      await confirmarSincronizacao(
        orderId,
        'delivered',
        normalizedEvent ||
          'FINALIZADO',
      )

      await atualizarStatusTele(
        '99food',
        orderId,
        'entregue',
      )

      return ok()
    }

    /*
     * Cancelamento.
     */
    if (
      CANCELLED_EVENTS.has(
        normalizedEvent,
      ) ||
      tipo === 'cancelado'
    ) {
      await atualizarStatusTele(
        '99food',
        orderId,
        'cancelado',
      )

      return ok()
    }

    /*
     * Somente eventos efetivamente reconhecidos como
     * criação podem inserir uma nova entrega.
     *
     * Antes, tipo "outro" também criava pedido e poderia
     * gerar duplicidade com eventos de atualização.
     */
    const isNewOrder =
      NEW_EVENTS.has(
        normalizedEvent,
      ) ||
      tipo === 'novo'

    if (isNewOrder) {
      const tele =
        normalizar99food(body)

      /*
       * Substitui qualquer ID eventualmente convertido
       * pelo JSON.parse pelo valor textual exato.
       */
      tele.external_id =
        orderId

      const shortId =
        tele.codigo
          ? String(tele.codigo)
            .replace('#', '')
          : orderId.slice(-4)

      const dbId =
        `99Food #${shortId} (${orderId})`

      /*
       * A 99Food pode reenviar o mesmo evento.
       */
      const state =
        await check99FoodOrderState(
          orderId,
        )

      if (state === 'history') {
        console.log(
          '[99Food webhook] Pedido já concluído; evento duplicado ignorado',
          {
            orderId,
            dbId,
          },
        )

        return ok()
      }

      if (state === 'pending') {
        await atualizarMetadados99Food(
          tele,
        )

        console.log(
          '[99Food webhook] Pedido pendente atualizado; inserção duplicada ignorada',
          {
            orderId,
            dbId,
          },
        )

        return ok()
      }

      await inserirTele(tele)

      /*
       * Confirmação automática do pedido.
       */
      try {
        const shopFromOrder =
          String(
            tele.food99_app_shop_id ??
            '',
          ).trim()

        const appShopId =
          shopFromOrder ||
          await obterAppShopIdBoraAcai()

        console.log(
          '[99Food webhook] Confirmando pedido automaticamente',
          {
            orderId,
            hasAppShopId:
              Boolean(appShopId),
          },
        )

        const confirmation =
          await acaoPedido99(
            appShopId,
            'confirmar',
            orderId,
          )

        console.log(
          '[99Food webhook] Resposta da confirmação automática',
          {
            orderId,
            errno:
              confirmation?.errno,
            httpStatus:
              confirmation
                ?.http_status,
          },
        )
      } catch (confirmationError) {
        /*
         * A falha na confirmação não deve apagar a entrega
         * recém-inserida, mas deve ficar visível nos logs.
         */
        console.error(
          '[99Food webhook] Falha na confirmação automática',
          {
            orderId,
            message:
              confirmationError
                instanceof Error
                ? confirmationError
                  .message
                : String(
                  confirmationError,
                ),
          },
        )
      }

      return ok()
    }

    /*
     * Eventos desconhecidos são registrados, mas não
     * inserem novos pedidos nem alteram estados.
     */
    console.warn(
      '[99Food webhook] Evento não mapeado; nenhuma alteração executada',
      {
        orderId,
        eventType:
          normalizedEvent || null,
        tipo,
      },
    )

    return ok()
  } catch (error) {
    console.error(
      '[99Food webhook] Erro ao processar evento',
      {
        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
    )

    /*
     * Mantém HTTP 200 com errno diferente de zero,
     * conforme o comportamento esperado pela integração.
     */
    return erro(
      'falha ao processar evento',
    )
  }
})

/**
 * Extrai o ID exatamente como chegou no JSON bruto.
 *
 * Suporta:
 * - orderId
 * - order_id
 * - orderURL
 * - order_url
 */
function extrairOrderId(
  raw: string,
  body: any,
): string {
  const rawPatterns = [
    /"orderId"\s*:\s*"(\d+)"/i,
    /"order_id"\s*:\s*"(\d+)"/i,
    /"orderId"\s*:\s*(\d+)/i,
    /"order_id"\s*:\s*(\d+)/i,
    /"orderURL"\s*:\s*"[^"]*\/orders\/(\d+)[^"]*"/i,
    /"order_url"\s*:\s*"[^"]*\/orders\/(\d+)[^"]*"/i,
  ]

  for (
    const pattern of rawPatterns
  ) {
    const match =
      raw.match(pattern)

    if (
      match?.[1] &&
      /^\d+$/.test(match[1])
    ) {
      return match[1]
    }
  }

  /*
   * Só usa valores do objeto quando já são strings.
   * Nunca converte um number potencialmente impreciso.
   */
  const candidates = [
    body?.orderId,
    body?.order_id,
    body?.data?.orderId,
    body?.data?.order_id,
  ]

  for (
    const candidate of candidates
  ) {
    if (
      typeof candidate === 'string'
    ) {
      const normalized =
        candidate.trim()

      if (/^\d+$/.test(normalized)) {
        return normalized
      }
    }
  }

  const urlCandidates = [
    body?.orderURL,
    body?.order_url,
    body?.data?.orderURL,
    body?.data?.order_url,
  ]

  for (
    const candidate of urlCandidates
  ) {
    if (
      typeof candidate !== 'string'
    ) {
      continue
    }

    const match =
      candidate.match(
        /\/orders\/(\d+)/i,
      )

    if (match?.[1]) {
      return match[1]
    }
  }

  return ''
}

/**
 * Extrai o nome do evento de diferentes formatos
 * usados pela 99Food.
 */
function extrairEventType(
  raw: string,
  body: any,
): string {
  const candidates = [
    body?.eventType,
    body?.event_type,
    body?.data?.eventType,
    body?.data?.event_type,
    body?.type,
    body?.data?.type,
  ]

  for (
    const candidate of candidates
  ) {
    if (
      typeof candidate === 'string' &&
      candidate.trim()
    ) {
      return candidate.trim()
    }
  }

  const rawMatch =
    raw.match(
      /"eventType"\s*:\s*"([^"]+)"/i,
    ) ??
    raw.match(
      /"event_type"\s*:\s*"([^"]+)"/i,
    )

  return rawMatch?.[1] ?? ''
}

function normalizarEventType(
  value: string,
): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
}

/**
 * Confirma no banco que o evento foi recebido.
 *
 * A tabela pending_deliveries é a fonte operacional
 * utilizada para controlar concorrência e sincronização.
 */
async function confirmarSincronizacao(
  orderId: string,
  event: SyncEvent,
  remoteEventType: string,
): Promise<void> {
  const sb =
    admin()

  const now =
    new Date().toISOString()

  const values:
    Record<string, unknown> =
    event === 'dispatch'
      ? {
        dispatch_status:
          'confirmado',
        dispatch_confirmed_at:
          now,
        dispatch_processing_at:
          null,
      }
      : {
        delivered_status:
          'confirmado',
        delivered_confirmed_at:
          now,
        delivered_processing_at:
          null,
      }

  /*
   * Primeiro tenta pelo external_id original.
   */
  const byExternalId =
    await sb
      .from('pending_deliveries')
      .update(values)
      .eq(
        'external_id',
        orderId,
      )
      .select('id')

  if (byExternalId.error) {
    throw byExternalId.error
  }

  let updatedCount =
    Array.isArray(
      byExternalId.data,
    )
      ? byExternalId.data.length
      : 0

  /*
   * Compatibilidade com registros antigos cujo ID
   * contém o orderId dentro do texto.
   */
  if (updatedCount === 0) {
    const byLegacyId =
      await sb
        .from(
          'pending_deliveries',
        )
        .update(values)
        .like(
          'id',
          `99Food %(${orderId})`,
        )
        .select('id')

    if (byLegacyId.error) {
      throw byLegacyId.error
    }

    updatedCount =
      Array.isArray(
        byLegacyId.data,
      )
        ? byLegacyId.data.length
        : 0
  }

  console.log(
    '[99Food webhook] Sincronização confirmada',
    {
      orderId,
      event,
      remoteEventType,
      updatedCount,
    },
  )
}