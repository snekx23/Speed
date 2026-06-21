// Garra Delivery — Configurações do Supabase
// Para separar os bancos de dados, altere os valores abaixo para as credenciais do seu novo projeto Supabase.
const SUPABASE_CONFIG = {
  url: 'https://evupemncvectyyeoeajz.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2dXBlbW5jdmVjdHl5ZW9lYWp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NjEyOTEsImV4cCI6MjA5NjMzNzI5MX0.QKW38pTwzkkTUKZqz5JUopOws9ftWJBYHMF4xICxips'
};

if (typeof window !== 'undefined') {
  window.SUPABASE_CONFIG = SUPABASE_CONFIG;
}
