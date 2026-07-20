import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-internal-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const cleanText = (value: unknown) => String(value ?? '').trim();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internalKey = Deno.env.get('PUSH_INTERNAL_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Configuração do servidor incompleta.' }, 500);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: 'Corpo da requisição inválido.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // O registro do aparelho confirma o PIN do login legado do próprio motoboy.
  // Isso evita que alguém cadastre uma assinatura para outro rider_id.
  if (body.action === 'register') {
    const riderId = cleanText(body.rider_id);
    const riderPin = cleanText(body.rider_pin);
    const subscription = body.subscription;
    if (!riderId || !riderPin || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return json({ error: 'Dados de assinatura inválidos.' }, 400);
    }

    const { data: rider, error: riderError } = await admin
      .from('fleet')
      .select('id, name')
      .eq('id', riderId)
      .eq('pin', riderPin)
      .maybeSingle();
    if (riderError || !rider) return json({ error: 'Motoboy não validado.' }, 403);

    const { error: saveError } = await admin
      .from('rider_push_subscriptions')
      .upsert({
        rider_id: rider.id,
        rider_name: rider.name,
        endpoint: subscription.endpoint,
        subscription_json: subscription,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' });
    if (saveError) return json({ error: saveError.message }, 500);
    return json({ ok: true });
  }

  // O envio é exclusivo do servidor/Database Webhook. Nunca exponha esta
  // chave no frontend, no Worker público ou no navegador do administrador.
  if (!internalKey || req.headers.get('x-push-internal-key') !== internalKey) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  const record = body.record ?? body;
  const riderId = cleanText(record.rider_id ?? record.motoboy_id);
  const riderName = cleanText(record.rider ?? record.rider_name ?? record.motoboy);
  if (!riderId && !riderName) return json({ ok: true, skipped: 'Entrega sem motoboy.' });

  let subscriptionsQuery = admin.from('rider_push_subscriptions').select('id, subscription_json');
  subscriptionsQuery = riderId
    ? subscriptionsQuery.eq('rider_id', riderId)
    : subscriptionsQuery.eq('rider_name', riderName);
  const { data: subscriptions, error: subscriptionsError } = await subscriptionsQuery;
  if (subscriptionsError) return json({ error: subscriptionsError.message }, 500);
  if (!subscriptions?.length) return json({ ok: true, sent: 0 });

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  if (!publicKey || !privateKey) return json({ error: 'Chaves VAPID não configuradas.' }, 500);

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') || 'mailto:suporte@garradelivery.com',
    publicKey,
    privateKey,
  );

  const code = cleanText(record.id ?? record.delivery_id ?? record.order_id) || 'Nova tele';
  const client = cleanText(record.client ?? record.client_name ?? record.recipient) || 'Cliente';
  const payload = JSON.stringify({
    title: 'Nova tele atribuída',
    body: `${code} • ${client}`,
    tag: `garra-delivery-${code}`,
    url: '/motoboy',
  });

  const expiredIds: string[] = [];
  let sent = 0;
  await Promise.all(subscriptions.map(async (item) => {
    try {
      await webpush.sendNotification(item.subscription_json, payload, { TTL: 60 });
      sent += 1;
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) expiredIds.push(item.id);
      console.error('Falha ao enviar Push:', error?.message || error);
    }
  }));

  if (expiredIds.length) await admin.from('rider_push_subscriptions').delete().in('id', expiredIds);
  return json({ ok: true, sent });
});
