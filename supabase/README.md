# Backend das integrações (iFood / 99Food)

Estas são as **Edge Functions** do Supabase que recebem os pedidos do iFood e do
99Food e gravam na tabela `pending_deliveries` (entram na Gestão de Teles).

> **Importante:** elas NÃO sobem com o deploy do app (wrangler). O app (frontend)
> e estas funções (backend) são deployados separadamente.

## Projeto Supabase

- ref: `evupemncvectyyeoeajz`
- URL: `https://evupemncvectyyeoeajz.supabase.co`

## Funções

| Função | Para quê | Auth |
|--------|----------|------|
| `food99-webhook` | Recebe pedidos do 99Food (novo/cancelado) | `--no-verify-jwt` (token na URL + assinatura) |
| `food99-vincular` | Gera o link de conexão self-service da loja | anon JWT |
| `food99-setup` | Deixa a loja vinculada online + confirmação pelo sistema | anon JWT |
| `food99-pedido` | Envia status do pedido pro 99Food (confirmar/pronto/entregue/cancelar) | anon JWT |
| `ifood-conectar` | Conecta a loja no iFood (fluxo userCode) — em homologação | anon JWT |
| `ifood-polling` | Busca pedidos novos do iFood (cron) — em homologação | anon JWT |
| `ifood-pedido` | Envia status do pedido pro iFood | anon JWT |

## Como deployar (precisa do Supabase CLI e do access token do projeto)

```bash
# de dentro da pasta garradelivery/
export SUPABASE_ACCESS_TOKEN=<access_token_do_supabase>

# o webhook do 99Food precisa do --no-verify-jwt
npx supabase@latest functions deploy food99-webhook --project-ref evupemncvectyyeoeajz --no-verify-jwt

# as demais:
for fn in food99-vincular food99-setup food99-pedido ifood-conectar ifood-pedido ifood-polling; do
  npx supabase@latest functions deploy "$fn" --project-ref evupemncvectyyeoeajz
done
```

## Webhook do 99Food (configurar no portal do 99Food)

```
https://evupemncvectyyeoeajz.supabase.co/functions/v1/food99-webhook?token=<WEBHOOK_99FOOD_TOKEN>
```

Os segredos (`FOOD99_APP_ID`, `FOOD99_SECRET`, `IFOOD_CLIENT_ID`, etc.) ficam em
**Supabase → Project Settings → Edge Functions → Secrets**.
