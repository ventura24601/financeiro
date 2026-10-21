// Uso: node scripts/gerar_hash_senha.mjs  (lê a senha do stdin, imprime APP_PASSWORD_HASH)
import { randomBytes, scryptSync } from "node:crypto";

let senha = "";
process.stdin.on("data", (c) => (senha += c));
process.stdin.on("end", () => {
  senha = senha.replace(/\r?\n$/, "");
  if (!senha) throw new Error("senha vazia");
  const salt = randomBytes(16);
  const hash = scryptSync(senha, salt, 64);
  process.stdout.write(`scrypt$${salt.toString("base64")}$${hash.toString("base64")}\n`);
});
