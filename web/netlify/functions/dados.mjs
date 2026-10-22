// GET /api/dados → dados do painel, lidos do Supabase no servidor.
import { autenticado, naoAutorizado } from "../../lib/auth.mjs";
import { carregarDados } from "../../lib/dados.mjs";

export default async (req) => {
  if (!autenticado(req)) return naoAutorizado();
  try {
    const { dados } = await carregarDados();
    return new Response(JSON.stringify(dados), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ erro: e.message }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
};

export const config = { path: "/api/dados" };
