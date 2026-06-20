# Garra Delivery

Plataforma de logística de entregas (teles) com painel administrativo, área do
parceiro/comércio e app do motoboy (PWA). Os pedidos podem ser criados
manualmente ou chegar automaticamente das integrações **iFood** e **99Food**.

🔗 **App no ar:** https://speed01.guigui-couto23.workers.dev

---

## Estrutura do projeto

```
garradelivery/
├── public/                  # o app (frontend, vanilla JS)
│   ├── index.html           # painel admin + área do parceiro (login)
│   ├── app.js               # lógica do painel
│   ├── motoboy.html         # app do motoboy (PWA)
│   ├── motoboy.js           # lógica do app do motoboy
│   ├── style.css            # estilos
│   ├── logo.jpg             # logo
│   ├── manifest*.json       # PWA (instalável)
│   └── sw.js                # service worker (offline / cache)
├── supabase/                # backend (banco + integrações)
│   ├── functions/           # Edge Functions (iFood / 99Food) — ver supabase/README.md
│   └── migrations/          # schema do banco
├── index.js                 # Cloudflare Worker (serve a pasta public/)
├── wrangler.jsonc           # config do deploy (worker "speed01")
└── vercel.json              # config de fallback (Vercel)
```

## Tecnologias

- **Frontend:** HTML + CSS + JavaScript puro (sem framework), [Leaflet](https://leafletjs.com) (mapa), [Chart.js](https://www.chartjs.org) (gráficos), [Lucide](https://lucide.dev) (ícones)
- **Backend:** [Supabase](https://supabase.com) — Postgres, Realtime, Auth e Edge Functions
- **Hospedagem:** Cloudflare Workers (serve os arquivos de `public/`)

## Perfis de acesso

| Perfil | O que faz |
|--------|-----------|
| **Administrador** | Gerencia teles, frota de motoboys, financeiro, repasse semanal, integrações |
| **Parceiro / Comércio** | Solicita entregas, rastreia o motoboy, vê histórico e avaliações |
| **Motoboy** | App PWA: recebe teles, navega no mapa e finaliza entregas (login por PIN) |

## Integrações (iFood / 99Food)

Pedidos do iFood e do 99Food entram automaticamente na **Gestão de Teles**
(tabela `pending_deliveries`). A conexão das lojas é feita pela aba
**Integrações** no painel do administrador.

O backend dessas integrações fica em [`supabase/`](supabase/README.md) — veja lá
as instruções de deploy das funções e a configuração do webhook do 99Food.

---

## Rodar localmente

Qualquer servidor de arquivos estáticos apontando pra pasta `public/` serve.
Exemplos:

```bash
# Python
python -m http.server 5599 --directory public

# ou Node
npx serve public
```

Depois abra `http://localhost:5599`.

## Deploy

> O **frontend** (app) e o **backend** (funções Supabase) são deployados
> separadamente.

### Frontend (Cloudflare Worker)

```bash
npx wrangler deploy
```

Publica os arquivos de `public/` no worker `speed01`
(https://speed01.guigui-couto23.workers.dev). Precisa estar logado na conta
Cloudflare dona do worker.

### Backend (Edge Functions do Supabase)

Veja o passo a passo em [`supabase/README.md`](supabase/README.md).

---

## Banco de dados (Supabase)

- Projeto ref: `evupemncvectyyeoeajz`
- Tabelas principais: `pending_deliveries` (teles no pool), `fleet` (motoboys),
  `delivery_bids` (lances), `client_history`, `global_settings`, além das tabelas
  de apoio das integrações (`lojas`, `ifood_tokens`, `food99_tokens`, `webhook_logs`).
