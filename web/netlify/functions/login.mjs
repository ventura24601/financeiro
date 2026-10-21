// POST /api/login {senha} → cookie de sessão. DELETE /api/login → sair.
// Bloqueio: 5 erros por IP = 15 min bloqueado; 30 erros no total em 1 h = login fechado por 1 h
// (a senha é curta, então a proteção contra tentativa e erro é obrigatória).
import { getStore } from "@netlify/blobs";
import { cookieSair, cookieSessao, senhaConfere } from "../../lib/auth.mjs";

const MAX_IP = 5, BLOQUEIO_IP = 15 * 60e3;
const MAX_GLOBAL = 30, JANELA_GLOBAL = 60 * 60e3;

const json = (status, corpo, extra = {}) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });

export default async (req, context) => {
  if (req.method === "DELETE") return json(200, { ok: true }, { "set-cookie": cookieSair });
  if (req.method !== "POST") return json(405, { erro: "método não permitido" });

  const store = getStore({ name: "login-tentativas", consistency: "strong" });
  const agora = Date.now();
  const chaveIp = `ip:${context.ip || "desconhecido"}`;
  const ip = (await store.get(chaveIp, { type: "json" })) || { falhas: 0, ate: 0 };
  let global = (await store.get("global", { type: "json" })) || { falhas: 0, inicio: agora };
  if (agora - global.inicio > JANELA_GLOBAL) global = { falhas: 0, inicio: agora };

  if (ip.ate > agora || global.falhas >= MAX_GLOBAL) {
    return json(429, { erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo." });
  }

  let senha = "";
  try {
    senha = (await req.json()).senha ?? "";
  } catch {}

  if (senha && senhaConfere(senha)) {
    await store.delete(chaveIp);
    return json(200, { ok: true }, { "set-cookie": cookieSessao() });
  }

  ip.falhas += 1;
  if (ip.falhas >= MAX_IP) Object.assign(ip, { falhas: 0, ate: agora + BLOQUEIO_IP });
  global.falhas += 1;
  await Promise.all([store.setJSON(chaveIp, ip), store.setJSON("global", global)]);
  await new Promise((r) => setTimeout(r, 600));
  return json(401, { erro: "Senha incorreta." });
};

export const config = { path: "/api/login" };
