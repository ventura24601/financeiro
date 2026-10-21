// GET /api/dados → dados do painel (empacotados na função, nunca servidos como arquivo público).
import dados from "../../dados/dados.json" with { type: "json" };
import { autenticado, naoAutorizado } from "../../lib/auth.mjs";

export default async (req) => {
  if (!autenticado(req)) return naoAutorizado();
  return new Response(JSON.stringify(dados), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};

export const config = { path: "/api/dados" };
