-- Migration 0007: Adiciona colunas para integração do 99Food na tabela de lojas
ALTER TABLE public.lojas ADD COLUMN IF NOT EXISTS food99_app_shop_id TEXT UNIQUE;
ALTER TABLE public.lojas ADD COLUMN IF NOT EXISTS food99_merchant_nome TEXT;
