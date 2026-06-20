// =====================================================================
// Camada de integração com a Merchant API do iFood (app Distribuído).
// Docs: https://developer.ifood.com.br/pt-BR/docs/guides
//
// Segredos (definir com `supabase secrets set`):
//   IFOOD_CLIENT_ID, IFOOD_CLIENT_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (já existem no ambiente da função)
// =====================================================================

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const IFOOD_BASE = 'https://merchant-api.ifood.com.br'
export const AUTH = `${IFOOD_BASE}/authentication/v1.0`
export const EVENTS = `${IFOOD_BASE}/events/v1.0`
export const ORDER = `${IFOOD_BASE}/order/v1.0`
export const MERCHANT = `${IFOOD_BASE}/merchant/v1.0`

export function clientId() {
  return Deno.env.get('IFOOD_CLIENT_ID') ?? ''
}
export function clientSecret() {
  return Deno.env.get('IFOOD_CLIENT_SECRET') ?? ''
}

export function admin(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

function form(obj: Record<string, string>) {
  return new URLSearchParams(obj).toString()
}

// ---------------------------------------------------------------------
// Passo 1 do userCode: gera o código que o lojista digita no Portal iFood.
// ---------------------------------------------------------------------
export interface UserCodeResp {
  userCode: string
  authorizationCodeVerifier: string
  verificationUrl: string
  verificationUrlComplete: string
  expiresIn: number
}

export async function gerarUserCode(): Promise<UserCodeResp> {
  const r = await fetch(`${AUTH}/oauth/userCode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ clientId: clientId() }),
  })
  if (!r.ok) throw new Error(`userCode falhou: ${r.status} ${await r.text()}`)
  return r.json()
}

// ---------------------------------------------------------------------
// Passo 2 do userCode: troca o authorizationCode (gerado quando o lojista
// autoriza) por access_token + refresh_token.
// ---------------------------------------------------------------------
export interface TokenResp {
  accessToken: string
  refreshToken: string
  expiresIn: number
  type?: string
}

export async function trocarToken(
  authorizationCode: string,
  authorizationCodeVerifier: string,
): Promise<TokenResp> {
  const r = await fetch(`${AUTH}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      grantType: 'authorization_code',
      clientId: clientId(),
      clientSecret: clientSecret(),
      authorizationCode,
      authorizationCodeVerifier,
    }),
  })
  if (!r.ok) throw new Error(`token falhou: ${r.status} ${await r.text()}`)
  return r.json()
}

export async function renovarToken(refreshToken: string): Promise<TokenResp> {
  const r = await fetch(`${AUTH}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      grantType: 'refresh_token',
      clientId: clientId(),
      clientSecret: clientSecret(),
      refreshToken,
    }),
  })
  if (!r.ok) throw new Error(`refresh falhou: ${r.status} ${await r.text()}`)
  return r.json()
}

// ---------------------------------------------------------------------
// Garante um access_token válido para a loja (renova se faltar < 5 min).
// Lê/grava em public.ifood_tokens.
// ---------------------------------------------------------------------
export async function tokenValido(sb: SupabaseClient, lojaId: string): Promise<string> {
  const { data, error } = await sb
    .from('ifood_tokens')
    .select('access_token, refresh_token, token_expira_em')
    .eq('loja_id', lojaId)
    .maybeSingle()
  if (error) throw error
  if (!data?.refresh_token) throw new Error('Loja sem token iFood (não conectada).')

  const expira = data.token_expira_em ? new Date(data.token_expira_em).getTime() : 0
  const faltaPouco = expira - Date.now() < 5 * 60 * 1000
  if (data.access_token && !faltaPouco) return data.access_token

  const novo = await renovarToken(data.refresh_token)
  await salvarToken(sb, lojaId, novo)
  return novo.accessToken
}

export async function salvarToken(sb: SupabaseClient, lojaId: string, t: TokenResp) {
  await sb.from('ifood_tokens').upsert({
    loja_id: lojaId,
    access_token: t.accessToken,
    refresh_token: t.refreshToken,
    token_expira_em: new Date(Date.now() + t.expiresIn * 1000).toISOString(),
    authorization_code_verifier: null,
    user_code: null,
    updated_at: new Date().toISOString(),
  })
}

// ---------------------------------------------------------------------
// Fetch autenticado genérico para a Merchant API.
// ---------------------------------------------------------------------
export async function ifoodFetch(
  sb: SupabaseClient,
  lojaId: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await tokenValido(sb, lojaId)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(url, { ...init, headers })
}
