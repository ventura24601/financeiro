// POST /api/analise {mensagens:[{role, content}]} → resposta da Claude em streaming (texto puro).
// Os dados financeiros vão para a API da Anthropic só aqui, por pedido explícito do CEO.
import { autenticado, naoAutorizado } from "../../lib/auth.mjs";
import { dadosCompactos, instrucoes } from "../../lib/contexto.mjs";
import { carregarDados } from "../../lib/dados.mjs";

const env = (k) => globalThis.Netlify?.env?.get(k) ?? process.env[k];
let contexto = { id: null, texto: "" };

export default async (req) => {
  if (!autenticado(req)) return naoAutorizado();
  if (req.method !== "POST") return new Response("método não permitido", { status: 405 });
  const chave = env("ANTHROPIC_API_KEY");
  if (!chave) return new Response("A chave ANTHROPIC_API_KEY não está configurada no Netlify.", { status: 503 });

  let mensagens = [];
  try {
    mensagens = (await req.json()).mensagens ?? [];
  } catch {}
  mensagens = mensagens
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!mensagens.length || mensagens.at(-1).role !== "user") return new Response("pergunta vazia", { status: 400 });

  try {
    const { id, dados } = await carregarDados();
    if (contexto.id !== id) contexto = { id, texto: dadosCompactos(dados) };
  } catch (e) {
    return new Response(`Dados indisponíveis: ${e.message}`, { status: 503 });
  }

  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env("CLAUDE_MODEL") || "claude-opus-5-5",
      max_tokens: 4000,
      stream: true,
      system: [
        { type: "text", text: instrucoes(hoje) },
        // Bloco grande e estável: fica em cache entre perguntas para reduzir custo e latência.
        { type: "text", text: `DADOS (JSON, valores em R$):\n${contexto.texto}`, cache_control: { type: "ephemeral" } },
      ],
      messages: mensagens,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    return new Response(`Erro da API (${resp.status}): ${txt.slice(0, 400)}`, { status: 502 });
  }

  // Converte o SSE da Anthropic em texto corrido para o navegador.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const corpo = resp.body.pipeThrough(new TransformStream({
    transform(chunk, ctrl) {
      buffer += decoder.decode(chunk, { stream: true });
      const linhas = buffer.split("\n");
      buffer = linhas.pop();
      for (const linha of linhas) {
        if (!linha.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(linha.slice(5));
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") ctrl.enqueue(encoder.encode(ev.delta.text));
          else if (ev.type === "error") ctrl.enqueue(encoder.encode(`\n\n[erro: ${ev.error?.message ?? "desconhecido"}]`));
        } catch {}
      }
    },
  }));
  return new Response(corpo, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
};

export const config = { path: "/api/analise" };
