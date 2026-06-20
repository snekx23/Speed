// Edge Function: conecta a conta iFood de uma loja (fluxo userCode distribuído).
//
// Duas ações (POST JSON):
//  1) { acao: "iniciar", loja_id }
//     -> gera o userCode. O lojista vai ao Portal do Parceiro iFood, digita
//        o código, autoriza, e recebe um "authorizationCode".
//     <- { userCode, verificationUrlComplete, expiresIn }
//
//  2) { acao: "concluir", loja_id, authorizationCode }
//     -> troca o authorizationCode por access/refresh token, descobre o
//        merchant e marca a loja como conectada.
//     <- { ok: true, merchant }

import { admin, gerarUserCode, trocarToken, salvarToken, ifoodFetch, MERCHANT } from '../_shared/ifood.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, erro: 'use POST' }, 405)

  try {
    const body = await req.json()
    const sb = admin()
    const lojaId: string = body.loja_id

    if (!lojaId) return json({ ok: false, erro: 'loja_id obrigatório' }, 400)

    // ---- 1) iniciar ----
    if (body.acao === 'iniciar') {
      const uc = await gerarUserCode()
      await sb.from('ifood_tokens').upsert({
        loja_id: lojaId,
        authorization_code_verifier: uc.authorizationCodeVerifier,
        user_code: uc.userCode,
        user_code_expira_em: new Date(Date.now() + uc.expiresIn * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      await sb.from('lojas').update({ status: 'conectando' }).eq('id', lojaId)
      return json({
        ok: true,
        userCode: uc.userCode,
        verificationUrlComplete: uc.verificationUrlComplete,
        expiresIn: uc.expiresIn,
      })
    }

    // ---- 2) concluir ----
    if (body.acao === 'concluir') {
      const authorizationCode: string = body.authorizationCode
      if (!authorizationCode) return json({ ok: false, erro: 'authorizationCode obrigatório' }, 400)

      const { data: tok } = await sb
        .from('ifood_tokens')
        .select('authorization_code_verifier')
        .eq('loja_id', lojaId)
        .maybeSingle()
      if (!tok?.authorization_code_verifier) {
        return json({ ok: false, erro: 'inicie a conexão primeiro (acao=iniciar)' }, 400)
      }

      const t = await trocarToken(authorizationCode.trim(), tok.authorization_code_verifier)
      await salvarToken(sb, lojaId, t)

      // Descobre o merchant ao qual o token tem acesso.
      let merchant: { id: string; name: string } | null = null
      try {
        const r = await ifoodFetch(sb, lojaId, `${MERCHANT}/merchants`)
        if (r.ok) {
          const lista = await r.json()
          if (Array.isArray(lista) && lista.length) {
            merchant = { id: lista[0].id, name: lista[0].name }
          }
        }
      } catch (_) { /* segue mesmo sem merchant */ }

      await sb
        .from('lojas')
        .update({
          status: 'conectada',
          ifood_merchant_id: merchant?.id ?? null,
          ifood_merchant_nome: merchant?.name ?? null,
        })
        .eq('id', lojaId)

      return json({ ok: true, merchant })
    }

    return json({ ok: false, erro: 'acao inválida (use iniciar|concluir)' }, 400)
  } catch (err) {
    return json({ ok: false, erro: String(err) }, 400)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
