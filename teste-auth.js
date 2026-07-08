const rawId = '2425';
const pin = '1234';

const digits = rawId.replace(/\D/g, '');
const motoboyId = `#MB-${digits}`;

console.log("Input ID:", rawId);
console.log("Normalized ID for query:", motoboyId);

async function run() {
  const url = `https://faowxiyxjfogkoynsohj.supabase.co/rest/v1/fleet?id=eq.${encodeURIComponent(motoboyId)}&pin=eq.${encodeURIComponent(pin)}&select=*`;
  const headers = {
    'apikey': 'sb_publishable_UFy_HB0JaKUVCvHUlHSQ0Q_2HFOk4_V',
    'authorization': 'Bearer sb_publishable_UFy_HB0JaKUVCvHUlHSQ0Q_2HFOk4_V'
  };

  try {
    const res = await fetch(url, { headers });
    console.log("HTTP Status:", res.status);
    const bodyText = await res.text();
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = bodyText;
    }
    console.log("Resultado:", data);
    console.log("ERRO REAL DO BANCO:", res.status >= 400 ? data : null);
  } catch (err) {
    console.log("ERRO DE REDE/EXCEÇÃO:", err);
  }
}

run();
