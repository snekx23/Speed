# Migração das integrações iFood e 99Food para o Supabase garradelivery

## Objetivo

Transferir as integrações iFood e 99Food do projeto Supabase antigo para o projeto `garradelivery`, preservando os dados operacionais que já existem no banco novo e realizando o corte do frontend e do webhook somente depois da validação do novo backend.

## Projetos

- Origem: `snekx23's Project` (`evupemncvectyyeoeajz`).
- Destino: `garradelivery` (`faowxiyxjfogkoynsohj`).

Credenciais, tokens e valores de segredos não devem ser gravados no repositório, em logs ou neste documento.

## Estado verificado

- A origem possui sete Edge Functions ativas: `food99-webhook`, `food99-vincular`, `food99-setup`, `food99-pedido`, `ifood-conectar`, `ifood-pedido` e `ifood-polling`.
- A origem possui os segredos customizados do iFood e 99Food.
- A origem possui duas lojas. As tabelas `ifood_tokens` e `food99_tokens` estão vazias no momento da inspeção.
- O destino ainda não possui Edge Functions nem segredos de integração.
- O destino já possui tabelas e dados operacionais do painel, que não devem ser sobrescritos.
- `pending_deliveries` existe no destino, mas precisa da coluna `bidding_started_at` usada pelas funções de integração.

## Estratégia

Usar uma migração direcionada e idempotente. Ela criará apenas as estruturas exigidas pelas integrações e complementará `pending_deliveries`, sem recriar ou apagar as tabelas operacionais existentes.

Estruturas a criar no destino:

- `lojas`, incluindo coordenadas de coleta e metadados iFood;
- `ifood_tokens`, protegida por RLS e sem acesso anônimo;
- `food99_tokens`, protegida por RLS e sem acesso anônimo;
- `webhook_logs`, protegida por RLS e sem acesso anônimo;
- coluna `pending_deliveries.bidding_started_at`.

Os registros das tabelas de integração serão copiados da origem por chave primária, com operações idempotentes. Nenhuma linha existente nas tabelas operacionais do destino será removida ou substituída.

## Segredos e funções

Copiar somente os segredos customizados:

- `FOOD99_APP_ID`;
- `FOOD99_APP_SHOP_ID`;
- `FOOD99_SECRET`;
- `WEBHOOK_99FOOD_TOKEN`;
- `IFOOD_CLIENT_ID`;
- `IFOOD_CLIENT_SECRET`.

Os segredos internos `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` permanecerão os valores automáticos do projeto de destino.

Depois do esquema e dos segredos, publicar as sete Edge Functions no projeto de destino. `food99-webhook` será publicado sem verificação JWT; as demais manterão a configuração atual.

## Corte do aplicativo

Após validar o backend novo:

1. Atualizar `public/app.js` e `public/motoboy.js` para a URL e chave pública do projeto `garradelivery`.
2. Atualizar a documentação com o novo project ref e os comandos corretos.
3. Publicar o frontend pelo fluxo conectado ao branch `main`.
4. Confirmar que o painel e o aplicativo do motoboy consultam o projeto novo.

## Corte do webhook 99Food

Trocar no portal do 99Food apenas depois de o novo endpoint responder corretamente. A URL usará o novo project ref e preservará o token existente sem exibi-lo em logs ou mensagens.

O endpoint antigo permanecerá ativo durante a validação. Depois da troca, um teste de callback confirmará que o evento chega ao novo `webhook_logs` e que um pedido de teste pode entrar em `pending_deliveries`.

## Validação

- Confirmar tabelas, colunas, RLS e contagens de dados no destino.
- Confirmar que os seis segredos customizados existem no destino sem revelar valores.
- Confirmar as sete Edge Functions como ativas.
- Testar o `GET` de saúde do webhook 99Food.
- Enviar um payload controlado autenticado pelo token do webhook, confirmar o log no banco novo e remover a linha de teste ao final.
- Validar `ifood-polling` sem executá-lo contra eventos reais durante a migração. A primeira execução com credenciais ativas ocorrerá somente no corte, pois a função reconhece e confirma eventos pendentes no iFood.
- Testar no frontend a leitura de frota, entregas, suporte e integrações usando o novo projeto.
- Confirmar a URL de produção após o deploy.

## Tratamento de falhas e rollback

- Fazer inventário e exportação das linhas de integração antes da escrita.
- Não apagar estruturas da origem durante a migração.
- Se uma função nova falhar, manter o frontend e o webhook apontando para a origem.
- Se o problema aparecer depois do corte, restaurar temporariamente a URL antiga no frontend e no portal 99Food enquanto o destino é corrigido.
- Remover ou desativar o backend antigo somente em uma tarefa separada, depois de um período de estabilidade.
