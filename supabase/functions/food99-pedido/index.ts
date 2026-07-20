// deno-lint-ignore-file no-explicit-any

// Edge Function: controla despacho, validação de PIN e conclusão
// de entregas da 99Food.
//
// POST JSON:
// {
//   order_id: string,
//   acao: "despachar" | "coletado" | "em_rota" | "entregue",
//   confirmation_code?: string
// }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import {
  despacharPedido99Food,
  finalizarEntrega99Food,
  obterPedido99Food,
  tokenAtual,
  validarPinEntrega99Food,
} from '../_shared/food99api.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type AcaoNormalizada =
  | 'despachar'
  | 'entregue'

interface RequestBody {
  order_id?: unknown
  acao?: unknown
  confirmation_code?: unknown
}

interface PedidoRow extends Record<string, unknown> {
  id?: unknown
  external_id?: unknown
  food99_app_shop_id?: unknown
  dispatch_status?: unknown
  delivered_status?: unknown
}

type SupabaseAdmin = any

class HttpError extends Error {
  status: number

  constructor(
    status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: cors,
    })
  }

  if (req.method !== 'POST') {
    return json(
      {
        ok: false,
        erro: 'Utilize o método POST.',
      },
      405,
    )
  }

  try {
    const body = await lerBody(req)

    const identificadorRecebido =
      String(body.order_id ?? '').trim()

    if (!identificadorRecebido) {
      throw new HttpError(
        400,
        'order_id é obrigatório.',
      )
    }

    const acao =
      normalizarAcao(body.acao)

    if (!acao) {
      throw new HttpError(
        400,
        `Ação não suportada: ${
          String(body.acao ?? '')
        }`,
      )
    }

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
      throw new HttpError(
        500,
        'Variáveis do Supabase não configuradas.',
      )
    }

     const sb: SupabaseAdmin = createClient(
  supabaseUrl,
  serviceRoleKey,
)

    /*
     * Localiza somente o pedido operacional.
     *
     * client_history não é utilizado para adquirir
     * travas ou controlar o envio para a 99Food.
     */
    const order =
      await buscarPedidoAtivo(
        sb,
        identificadorRecebido,
      )

    if (!order) {
      throw new HttpError(
        404,
        'Pedido ativo da 99Food não encontrado.',
      )
    }

    const rowId =
      String(order.id ?? '').trim()

    if (!rowId) {
      throw new HttpError(
        500,
        'Pedido local sem identificador interno.',
      )
    }

    /*
     * Sempre utiliza o external_id salvo pelo webhook.
     *
     * Não utiliza displayId, shortId ou o ID textual
     * montado pelo sistema.
     */
    const orderId =
      String(
        order.external_id ?? '',
      ).trim()

    if (!orderId) {
      throw new HttpError(
        409,
        'Pedido sem external_id da 99Food.',
      )
    }

    /*
     * Mantém o identificador como string.
     *
     * Nunca use Number, parseInt ou BigInt.
     */
    if (!/^\d+$/.test(orderId)) {
      throw new HttpError(
        409,
        'external_id da 99Food possui formato inválido.',
      )
    }

    const appShopId =
  String(
    order.food99_app_shop_id ??
    Deno.env.get(
      'FOOD99_APP_SHOP_ID',
    ) ??
    '',
  ).trim()

    if (!appShopId) {
      throw new HttpError(
        409,
        'app_shop_id da loja não configurado.',
      )
    }

    if (acao === 'despachar') {
      return await executarDespacho({
        sb,
        order,
        rowId,
        orderId,
        appShopId,
      })
    }

    return await executarEntrega({
      sb,
      order,
      rowId,
      orderId,
      appShopId,
      confirmationCode:
        body.confirmation_code,
    })
  } catch (error) {
    const status =
      error instanceof HttpError
        ? error.status
        : 500

    const message =
      error instanceof Error
        ? error.message
        : 'Erro interno inesperado.'

    /*
     * Não registrar body, PIN ou token.
     */
    console.error(
      '[food99-pedido] Falha',
      {
        status,
        message,
      },
    )

    return json(
      {
        ok: false,
        erro: message,
      },
      status,
    )
  }
})

async function executarDespacho(
  params: {
    sb: SupabaseAdmin
    order: PedidoRow
    rowId: string
    orderId: string
    appShopId: string
  },
): Promise<Response> {
  const {
    sb,
    order,
    rowId,
    orderId,
    appShopId,
  } = params

  /*
   * Faz a reserva atômica.
   *
   * Somente uma requisição consegue alterar a linha
   * de pendente/falhou para processando.
   */
  const reservationTime =
    new Date().toISOString()

  const {
    data: claimedOrder,
    error: claimError,
  } = await sb
    .from('pending_deliveries')
    .update({
      dispatch_status: 'processando',
      dispatch_processing_at:
        reservationTime,
    })
    .eq('id', rowId)
    .is(
      'dispatch_processing_at',
      null,
    )
    .or(
      'dispatch_status.is.null,dispatch_status.eq.pendente,dispatch_status.eq.falhou',
    )
    .select(
      'id, external_id, dispatch_status',
    )
    .maybeSingle()

  if (claimError) {
    throw erroBanco(claimError)
  }

  /*
   * Nenhuma linha alterada significa que outra
   * requisição já iniciou ou enviou o despacho.
   */
  if (!claimedOrder) {
    return json({
      ok: true,
      status:
        'already_processing_or_sent',
      dispatch_status:
        String(
          order.dispatch_status ??
          'desconhecido',
        ),
      mensagem:
        'O despacho já está sendo processado ou foi enviado.',
    })
  }

  try {
    const token =
      await tokenAtual(appShopId)

    const result =
      await despacharPedido99Food(
        orderId,
        token,
        appShopId,
      )

    if (
      result.ok &&
      result.accepted
    ) {
      const sentAt =
        new Date().toISOString()

      await atualizarPedido(
        sb,
        rowId,
        {
          dispatch_status: 'aceito',
          dispatch_sent_at: sentAt,
          dispatch_processing_at: null,
        },
      )

      return json({
        ok: true,
        status: 'accepted',
        remote_http_status:
          result.status,
        mensagem:
          'Despacho aceito pela 99Food. Aguardando confirmação do webhook.',
      })
    }

    if (
      result.reconciliationRequired
    ) {
      await atualizarPedido(
        sb,
        rowId,
        {
          dispatch_status:
            'reconciliacao_necessaria',
          dispatch_sent_at:
            new Date().toISOString(),
          dispatch_processing_at: null,
        },
      )

      return json(
        {
          ok: false,
          status:
            'reconciliation_required',
          remote_http_status:
            result.status,
          reconciliacao_necessaria:
            true,
          erro:
            result.message ??
            'O estado precisa ser confirmado pelo webhook da 99Food.',
        },
        409,
      )
    }

    await atualizarPedido(
      sb,
      rowId,
      {
        dispatch_status: 'falhou',
        dispatch_processing_at: null,
      },
    )

    return json(
      {
        ok: false,
        status: 'failed',
        remote_http_status:
          result.status,
        erro:
          result.message ??
          'A 99Food recusou o despacho.',
      },
      502,
    )
  } catch (error) {
    /*
     * Libera a trava para permitir nova tentativa
     * quando ocorreu uma falha real.
     */
    try {
      await atualizarPedido(
        sb,
        rowId,
        {
          dispatch_status: 'falhou',
          dispatch_processing_at: null,
        },
      )
    } catch (updateError) {
      console.error(
        '[food99-pedido] Não foi possível liberar a trava do despacho',
        {
          message:
            updateError instanceof Error
              ? updateError.message
              : String(updateError),
        },
      )
    }

    throw error
  }
}

async function executarEntrega(
  params: {
    sb: SupabaseAdmin
    order: PedidoRow
    rowId: string
    orderId: string
    appShopId: string
    confirmationCode: unknown
  },
): Promise<Response> {
  const {
    sb,
    order,
    rowId,
    orderId,
    appShopId,
    confirmationCode,
  } = params

  /*
   * PIN sempre permanece como string.
   *
   * Um PIN como 0123 não pode virar 123.
   */
  const deliveryCode =
    String(
      confirmationCode ?? '',
    ).trim()

  if (!deliveryCode) {
    throw new HttpError(
      400,
      'Informe o PIN fornecido pelo cliente.',
    )
  }

  const token =
    await tokenAtual(appShopId)

  /*
   * A função compartilhada já renova o token em
   * caso de HTTP 401 e tenta somente mais uma vez.
   */
  const validation =
    await validarPinEntrega99Food(
      orderId,
      deliveryCode,
      token,
      appShopId,
    )

  if (
    validation.status === 400
  ) {
    return json(
      {
        ok: false,
        code:
          'INVALID_DELIVERY_PIN',
        erro:
          'PIN informado pelo cliente está incorreto.',
      },
      400,
    )
  }

  if (!validation.ok) {
    return json(
      {
        ok: false,
        code:
          'PIN_VALIDATION_FAILED',
        remote_http_status:
          validation.status,
        erro:
          validation.message ??
          'Não foi possível validar o PIN na 99Food.',
      },
      502,
    )
  }

  /*
   * Se o token foi renovado durante a validação,
   * utiliza o novo valor nas próximas chamadas.
   */
  const currentToken =
    validation.token ?? token

  /*
   * Consulta os detalhes do pedido antes de chamar
   * o endpoint /delivered.
   */
  const orderResponse =
    await obterPedido99Food(
      orderId,
      currentToken,
      appShopId,
    )

  const remoteOrder =
    extrairPedidoRemoto(orderResponse)

  const delivery =
    isRecord(remoteOrder.delivery)
      ? remoteOrder.delivery
      : {}

  const deliveredBy =
    String(
      delivery.deliveredBy ?? '',
    )
      .trim()
      .toUpperCase()

  const sendDelivered =
    remoteOrder.sendDelivered === true

  /*
   * Não força /delivered quando a plataforma não
   * solicita essa atualização.
   */
  if (
    deliveredBy !== 'MERCHANT' ||
    !sendDelivered
  ) {
    await atualizarPedido(
      sb,
      rowId,
      {
        delivered_status:
          'nao_requerido',
        delivered_processing_at:
          null,
      },
    )

    return json({
      ok: true,
      status: 'completed_locally',
      skipped_remote_delivered:
        true,
      delivered_by:
        deliveredBy || null,
      send_delivered:
        sendDelivered,
      mensagem:
        'PIN validado. A 99Food não solicitou o envio do evento delivered.',
    })
  }

  /*
   * Reserva atômica da conclusão da entrega.
   */
  const reservationTime =
    new Date().toISOString()

  const {
    data: claimedOrder,
    error: claimError,
  } = await sb
    .from('pending_deliveries')
    .update({
      delivered_status: 'processando',
      delivered_processing_at:
        reservationTime,
    })
    .eq('id', rowId)
    .is(
      'delivered_processing_at',
      null,
    )
    .or(
      'delivered_status.is.null,delivered_status.eq.pendente,delivered_status.eq.falhou',
    )
    .select(
      'id, external_id, delivered_status',
    )
    .maybeSingle()

  if (claimError) {
    throw erroBanco(claimError)
  }

  if (!claimedOrder) {
    return json({
      ok: true,
      status:
        'already_processing_or_sent',
      delivered_status:
        String(
          order.delivered_status ??
          'desconhecido',
        ),
      mensagem:
        'A conclusão já está sendo processada ou foi enviada.',
    })
  }

  try {
    const result =
      await finalizarEntrega99Food(
        orderId,
        currentToken,
        appShopId,
      )

    if (
      result.ok &&
      result.accepted
    ) {
      const sentAt =
        new Date().toISOString()

      await atualizarPedido(
        sb,
        rowId,
        {
          delivered_status: 'aceito',
          delivered_sent_at: sentAt,
          delivered_processing_at:
            null,
        },
      )

      return json({
        ok: true,
        status: 'accepted',
        remote_http_status:
          result.status,
        mensagem:
          'Entrega aceita pela 99Food. Aguardando confirmação do webhook.',
      })
    }

    if (
      result.reconciliationRequired
    ) {
      await atualizarPedido(
        sb,
        rowId,
        {
          delivered_status:
            'reconciliacao_necessaria',
          delivered_sent_at:
            new Date().toISOString(),
          delivered_processing_at:
            null,
        },
      )

      return json(
        {
          ok: false,
          status:
            'reconciliation_required',
          reconciliacao_necessaria:
            true,
          remote_http_status:
            result.status,
          erro:
            result.message ??
            'A conclusão precisa ser confirmada pelo webhook.',
        },
        409,
      )
    }

    await atualizarPedido(
      sb,
      rowId,
      {
        delivered_status: 'falhou',
        delivered_processing_at:
          null,
      },
    )

    return json(
      {
        ok: false,
        status: 'failed',
        remote_http_status:
          result.status,
        erro:
          result.message ??
          'A 99Food recusou a conclusão da entrega.',
      },
      502,
    )
  } catch (error) {
    try {
      await atualizarPedido(
        sb,
        rowId,
        {
          delivered_status: 'falhou',
          delivered_processing_at:
            null,
        },
      )
    } catch (updateError) {
      console.error(
        '[food99-pedido] Não foi possível liberar a trava da entrega',
        {
          message:
            updateError instanceof Error
              ? updateError.message
              : String(updateError),
        },
      )
    }

    throw error
  }
}

async function buscarPedidoAtivo(
  sb: SupabaseAdmin,
  identifier: string,
): Promise<PedidoRow | null> {
  /*
   * Primeiro tenta localizar pelo external_id real.
   */
  const byExternalId =
    await sb
      .from('pending_deliveries')
      .select('*')
      .eq(
        'external_id',
        identifier,
      )
      .maybeSingle()

  if (byExternalId.error) {
    throw erroBanco(
      byExternalId.error,
    )
  }

  if (byExternalId.data) {
    return byExternalId.data as PedidoRow
  }

  /*
   * Compatibilidade com chamadas que ainda enviam
   * o ID interno da tabela.
   */
  const byInternalId =
    await sb
      .from('pending_deliveries')
      .select('*')
      .eq('id', identifier)
      .maybeSingle()

  if (byInternalId.error) {
    throw erroBanco(
      byInternalId.error,
    )
  }

  if (byInternalId.data) {
    return byInternalId.data as PedidoRow
  }

  /*
   * Compatibilidade com IDs textuais legados:
   * 99Food #1234 (5764678584463592104)
   */
  const byLegacyId =
    await sb
      .from('pending_deliveries')
      .select('*')
      .like(
        'id',
        `99Food %(${identifier})`,
      )
      .maybeSingle()

  if (byLegacyId.error) {
    throw erroBanco(
      byLegacyId.error,
    )
  }

  return (
    byLegacyId.data as PedidoRow | null
  )
}

async function atualizarPedido(
  sb: SupabaseAdmin,
  rowId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { error } =
    await sb
      .from('pending_deliveries')
      .update(values)
      .eq('id', rowId)

  if (error) {
    throw erroBanco(error)
  }
}

function extrairPedidoRemoto(
  value: unknown,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(
      502,
      'A 99Food retornou um pedido inválido.',
    )
  }

  if (isRecord(value.data)) {
    return value.data
  }

  return value
}

function normalizarAcao(
  value: unknown,
): AcaoNormalizada | null {
  const action =
    String(value ?? '')
      .trim()
      .toLowerCase()

  if (
    action === 'despachar' ||
    action === 'coletado' ||
    action === 'em_rota'
  ) {
    return 'despachar'
  }

  if (
    action === 'entregue' ||
    action === 'finalizar' ||
    action === 'concluir'
  ) {
    return 'entregue'
  }

  return null
}

async function lerBody(
  req: Request,
): Promise<RequestBody> {
  try {
    return (
      await req.json()
    ) as RequestBody
  } catch {
    throw new HttpError(
      400,
      'O corpo da requisição não contém um JSON válido.',
    )
  }
}

function erroBanco(
  error: unknown,
): HttpError {
  if (isRecord(error)) {
    const code =
      String(error.code ?? '')

    const message =
      String(
        error.message ??
        'Erro desconhecido no banco.',
      )

    if (code === '42703') {
      return new HttpError(
        500,
        'A migração de sincronização da 99Food ainda não foi aplicada no banco.',
      )
    }

    return new HttpError(
      500,
      `Erro no banco de dados: ${message}`,
    )
  }

  return new HttpError(
    500,
    'Erro desconhecido no banco de dados.',
  )
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function json(
  body: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...cors,
        'Content-Type':
          'application/json; charset=utf-8',
      },
    },
  )
}