// Sessão por cookie assinado (HMAC) + senha verificada contra hash scrypt em variável de ambiente.
// APP_PASSWORD_HASH = "scrypt$<salt base64>$<hash base64>"  (gerado por scripts/gerar_hash_senha.mjs)
// APP_SECRET_KEY    = segredo aleatório para assinar a sessão
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

const HORAS_SESSAO = 12;
const env = (k) => (globalThis.Netlify?.env?.get(k) ?? process.env[k]);

export function senhaConfere(senha) {
  const [alg, salt, hash] = String(env("APP_PASSWORD_HASH") || "").split("$");
  if (alg !== "scrypt" || !salt || !hash) throw new Error("APP_PASSWORD_HASH não configurado");
  const esperado = Buffer.from(hash, "base64");
  const obtido = scryptSync(String(senha), Buffer.from(salt, "base64"), esperado.length);
  return timingSafeEqual(esperado, obtido);
}

function assinar(valor) {
  const segredo = env("APP_SECRET_KEY");
  if (!segredo) throw new Error("APP_SECRET_KEY não configurado");
  return createHmac("sha256", segredo).update(valor).digest("base64url");
}

export function cookieSessao() {
  const exp = String(Date.now() + HORAS_SESSAO * 3600 * 1000);
  return `sessao=${exp}.${assinar(exp)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${HORAS_SESSAO * 3600}`;
}

export const cookieSair = "sessao=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";

export function autenticado(req) {
  const m = /(?:^|;\s*)sessao=(\d+)\.([\w-]+)/.exec(req.headers.get("cookie") || "");
  if (!m || Number(m[1]) < Date.now()) return false;
  const a = Buffer.from(m[2]);
  const b = Buffer.from(assinar(m[1]));
  return a.length === b.length && timingSafeEqual(a, b);
}

export const naoAutorizado = () =>
  new Response(JSON.stringify({ erro: "não autenticado" }), {
    status: 401,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
