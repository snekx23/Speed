// Garra Delivery — Configurações do Supabase
// Para separar os bancos de dados, altere os valores abaixo para as credenciais do seu novo projeto Supabase.
const SUPABASE_CONFIG = {
  url: 'https://faowxiyxjfogkoynsohj.supabase.co',
  key: 'sb_publishable_UFy_HB0JaKUVCvHUlHSQ0Q_2HFOk4_V'
};

if (typeof window !== 'undefined') {
  window.SUPABASE_CONFIG = SUPABASE_CONFIG;
}
