// POST /api/upload (corpo = o arquivo; cabeçalho x-arquivo = nome) → guarda no bucket privado `extratos`,
// registra em `processamentos` e dispara o processamento no GitHub Actions (se houver token).
// GET /api/upload → últimos processamentos (status e log), para a aba "Atualizar dados".
import { autenticado, naoAutorizado } from "../../lib/auth.mjs";

const env = (k) => globalThis.Netlify?.env?.get(k) ?? process.env[k];
const EXTENSOES = /\.(xlsx|csv|ofx)$/i;
const MAX_BYTES = 8 * 1024 * 1024;
const REPO = "ventura24601/financeiro";
const WORKFLOW = "processar-uploads.yml";

const json = (status, corpo) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function supa(caminho, opcoes = {}) {
  const chave = env("SUPABASE_SERVICE_KEY");
  const r = await fetch(`${env("SUPABASE_URL")}${caminho}`, {
    ...opcoes,
    headers: { apikey: chave, authorization: `Bearer ${chave}`, ...(opcoes.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

async function disparar() {
  const token = env("GITHUB_DISPATCH_TOKEN");
  if (!token) return false;
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "painel-financeiro" },
    body: JSON.stringify({ ref: "main" }),
  });
  return r.status === 204;
}

export default async (req) => {
  if (!autenticado(req)) return naoAutorizado();

  if (req.method === "GET") {
    const r = await supa("/rest/v1/processamentos?select=id,criado_em,arquivo,tamanho_bytes,status,resumo,log,concluido_em&order=id.desc&limit=20");
    return json(200, { processamentos: await r.json(), disparo_automatico: Boolean(env("GITHUB_DISPATCH_TOKEN")) });
  }
  if (req.method !== "POST") return json(405, { erro: "método não permitido" });

  if (req.headers.get("content-type") !== "application/octet-stream") {
    return json(415, { erro: "Envie o arquivo como application/octet-stream." });  // evita o corpo ser tratado como texto
  }
  const nome = decodeURIComponent(req.headers.get("x-arquivo") || "").trim();
  if (!EXTENSOES.test(nome)) return json(400, { erro: "Formato não suportado. Envie XLSX (Itaú), CSV (Vindi) ou OFX." });
  const corpo = await req.arrayBuffer();
  if (!corpo.byteLength) return json(400, { erro: "Arquivo vazio." });
  if (corpo.byteLength > MAX_BYTES) return json(413, { erro: "Arquivo maior que 8 MB." });

  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const caminho = `${hoje}/${Date.now()}_${nome.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  await supa(`/storage/v1/object/extratos/${caminho}`, {
    method: "POST", body: corpo, headers: { "content-type": "application/octet-stream", "x-upsert": "false" },
  });
  const r = await supa("/rest/v1/processamentos?select=id", {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({ arquivo: nome, caminho, tamanho_bytes: corpo.byteLength }),
  });
  const [{ id }] = await r.json();
  const disparado = await disparar().catch(() => false);
  return json(200, { id, disparado });
};

export const config = { path: "/api/upload" };
