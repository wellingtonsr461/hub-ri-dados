// Confere se selecoes-pos.json tem o formato que o app aceita. Sai com erro se algo estiver errado.
// Uso: node ferramentas/validar-selecoes.mjs [caminho/do/selecoes-pos.json]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { AREAS, ESFERAS, NIVEIS, normalizarLink } from './importar-selecoes.mjs';

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function diaOuNulo(valor, nome, rotulo) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'string' || !DIA.test(valor) || new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) !== valor) {
    throw new Error(`${nome} fora do formato AAAA-MM-DD (${valor}): ${rotulo}`);
  }
  return valor;
}

// Devolve { total, conferidoEm } ou lança erro dizendo o que está errado.
export function validarArquivoDeSelecoes(texto) {
  const o = JSON.parse(texto);
  if (typeof o !== 'object' || o === null || !Array.isArray(o.selecoes)) throw new Error('selecoes-pos.json sem a lista "selecoes".');
  if (typeof o.conferidoEm !== 'string' || !DIA.test(o.conferidoEm)) throw new Error('selecoes-pos.json sem "conferidoEm" válido.');
  const ids = new Set();
  const links = new Set();
  for (const s of o.selecoes) {
    const rotulo = `${s?.programa ?? '?'} / ${s?.instituicao ?? '?'}`;
    for (const campo of ['id', 'programa', 'instituicao', 'link', 'fonte']) {
      if (typeof s?.[campo] !== 'string' || s[campo].trim() === '') throw new Error(`Seleção sem "${campo}": ${rotulo}`);
    }
    if (ids.has(s.id)) throw new Error(`id repetido: ${s.id}`);
    ids.add(s.id);
    if (!s.link.startsWith('https://')) throw new Error(`Link sem https: ${rotulo}`);
    const chave = normalizarLink(s.link);
    if (links.has(chave)) throw new Error(`Link repetido: ${s.link}`);
    links.add(chave);
    if (!ESFERAS.includes(s.esfera)) throw new Error(`Esfera inválida (${s.esfera}): ${rotulo}`);
    if (!AREAS.includes(s.area)) throw new Error(`Área inválida (${s.area}): ${rotulo}`);
    if (!Array.isArray(s.niveis) || s.niveis.length === 0 || !s.niveis.every((n) => NIVEIS.includes(n))) throw new Error(`Níveis inválidos: ${rotulo}`);
    const de = diaOuNulo(s.inscricoesDe, 'inscricoesDe', rotulo);
    const ate = diaOuNulo(s.inscricoesAte, 'inscricoesAte', rotulo);
    if (de && ate && de > ate) throw new Error(`Datas que se contradizem: ${rotulo}`);
  }
  return { total: o.selecoes.length, conferidoEm: o.conferidoEm };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { total, conferidoEm } = validarArquivoDeSelecoes(readFileSync(process.argv[2] ?? 'selecoes-pos.json', 'utf8'));
  console.log(`selecoes-pos.json válido: ${total} seleções, conferido em ${conferidoEm}.`);
}
