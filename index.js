export default {
  async fetch(request, env, ctx) {
    const response = await env.ASSETS.fetch(request);
    
    // Clona a resposta para permitir modificação de cabeçalhos
    const newResponse = new Response(response.body, response);
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Desabilita cache para arquivos HTML, JS, CSS e JSON para evitar cache travado
    if (
      path === '/' ||
      path.endsWith('.html') ||
      path.endsWith('.js') ||
      path.endsWith('.css') ||
      path.endsWith('.json')
    ) {
      newResponse.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      newResponse.headers.set('Pragma', 'no-cache');
      newResponse.headers.set('Expires', '0');
    }
    
    return newResponse;
  }
};
