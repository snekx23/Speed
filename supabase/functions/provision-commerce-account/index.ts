import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
})

type ProvisionRequest = {
  nome?: string
  telefone?: string | null
  cidade?: string | null
  email?: string
  password?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) return json({ error: 'Configuração do servidor ausente.' }, 500)

  const authorization = req.headers.get('Authorization') || ''
  const accessToken = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!accessToken) return json({ error: 'Sessão de administrador obrigatória.' }, 401)

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    // The caller token is verified first; service role is never sent to the browser.
    const { data: userData, error: userError } = await admin.auth.getUser(accessToken)
    if (userError || !userData.user) return json({ error: 'Sessão inválida.' }, 401)

    const { data: callerProfile, error: profileError } = await admin
      .from('perfis')
      .select('papel')
      .eq('id', userData.user.id)
      .maybeSingle()
    if (profileError) throw profileError
    if (callerProfile?.papel !== 'admin') return json({ error: 'Apenas administradores podem cadastrar clientes.' }, 403)

    const payload = await req.json() as ProvisionRequest
    const nome = String(payload.nome || '').trim()
    const email = String(payload.email || '').trim().toLowerCase()
    const password = String(payload.password || '')
    const telefone = String(payload.telefone || '').trim() || null
    const cidade = String(payload.cidade || '').trim() || null

    if (!nome || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
      return json({ error: 'Informe nome, e-mail válido e senha com ao menos 8 caracteres.' }, 400)
    }

    const { data: existingStore, error: existingStoreError } = await admin
      .from('lojas')
      .select('id')
      .ilike('email', email)
      .maybeSingle()
    if (existingStoreError) throw existingStoreError
    if (existingStore) return json({ error: 'Já existe uma loja cadastrada para este e-mail.' }, 409)

    const { data: store, error: storeError } = await admin
      .from('lojas')
      .insert({ nome, phone: telefone, city: cidade, email, status: 'conectada' })
      .select('id, nome, email')
      .single()
    if (storeError) throw storeError

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome, loja_id: store.id },
    })
    if (authError || !authData.user) {
      await admin.from('lojas').delete().eq('id', store.id)
      return json({ error: authError?.message || 'Não foi possível criar a conta de acesso.' }, 400)
    }

    const { error: linkError } = await admin
      .from('perfis')
      .insert({ id: authData.user.id, nome, papel: 'parceiro', loja_id: store.id })
    if (linkError) {
      await admin.auth.admin.deleteUser(authData.user.id)
      await admin.from('lojas').delete().eq('id', store.id)
      throw linkError
    }

    return json({ ok: true, loja: store, user_id: authData.user.id }, 201)
  } catch (error) {
    console.error('provision-commerce-account failed:', error)
    return json({ error: error instanceof Error ? error.message : 'Erro ao provisionar cliente.' }, 500)
  }
})
