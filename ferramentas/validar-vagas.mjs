// Confere se vagas.json tem o formato que o app aceita. Sai com erro se algo estiver errado.
// Uso: node ferramentas/validar-vagas.mjs [caminho/do/vagas.json]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CAMPOS, TIPOS, dominioRecusado } from './importar-vagas.mjs';

// Devolve { total, conferidoEm } ou lança erro dizendo o que está errado.
export function validarArquivoDeVagas(texto) {
  const o = JSON.parse(texto);
  if (typeof o !== 'object' || o === null || !Array.isArray(o.vagas)) throw new Error('vagas.json sem a lista "vagas".');
  if (typeof o.conferidoEm !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.conferidoEm)) throw new Error('vagas.json sem "conferidoEm" válido.');
  const links = new Set();
  for (const v of o.vagas) {
    const nome = v?.titulo ?? '?';
    if (typeof v?.link !== 'string' || !v.link.startsWith('https://')) throw new Error(`Vaga sem link https: ${nome}`);
    const host = new URL(v.link).hostname;
    if (dominioRecusado(host)) throw new Error(`Link de domínio recusado (${host}): ${nome}`);
    if (links.has(v.link)) throw new Error(`Link repetido: ${v.link}`);
    links.add(v.link);
    if (!CAMPOS.includes(v.campo)) throw new Error(`Campo inválido (${v.campo}): ${nome}`);
    if (!TIPOS.includes(v.tipo)) throw new Error(`Tipo inválido (${v.tipo}): ${nome}`);
  }
  return { total: o.vagas.length, conferidoEm: o.conferidoEm };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { total, conferidoEm } = validarArquivoDeVagas(readFileSync(process.argv[2] ?? 'vagas.json', 'utf8'));
  console.log(`vagas.json válido: ${total} vagas, conferido em ${conferidoEm}.`);
}
