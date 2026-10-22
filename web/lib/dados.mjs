// Lê a publicação mais recente do painel no Supabase (service_role, só no servidor).
const env = (k) => globalThis.Netlify?.env?.get(k) ?? process.env[k];
const CACHE_MS = 60_000;
let cache = { em: 0, valor: null };

export async function carregarDados() {
  if (cache.valor && Date.now() - cache.em < CACHE_MS) return cache.valor;
  const url = env("SUPABASE_URL");
  const chave = env("SUPABASE_SERVICE_KEY");
  if (!url || !chave) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados");
  const r = await fetch(`${url}/rest/v1/painel_publicacoes?select=id,dados&order=id.desc&limit=1`, {
    headers: { apikey: chave, authorization: `Bearer ${chave}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const [linha] = await r.json();
  if (!linha) throw new Error("nenhum dado publicado ainda (rode: python -m financeiro publicar)");
  cache = { em: Date.now(), valor: { id: linha.id, dados: linha.dados } };
  return cache.valor;
}
