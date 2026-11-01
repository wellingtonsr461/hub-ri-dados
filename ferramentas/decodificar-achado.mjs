// Transforma o conteúdo bruto de um documento do Drive (texto simples ou base64, com ou sem BOM e cercas de código)
// numa lista JSON de achados, pronta para os importadores. Se o fim do documento veio cortado, aproveita os itens completos.
//
// Uso: node ferramentas/importar/decodificar-achado.mjs entrada.txt saida.json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function pareceBase64(texto) {
  const compacto = texto.replace(/\s+/g, '');
  return compacto.length >= 16 && /^[A-Za-z0-9+/]+={0,2}$/.test(compacto);
}

function paraTexto(conteudo) {
  const bruto = String(conteudo).trim();
  if (!pareceBase64(bruto)) return bruto.replace(/^﻿/, '');
  const compacto = bruto.replace(/\s+/g, '');
  // Base64 cortado no meio: descarta os caracteres que não fecham um bloco de 4.
  const inteiro = compacto.slice(0, compacto.length - (compacto.length % 4));
  return Buffer.from(inteiro, 'base64').toString('utf8').replace(/^﻿/, '');
}

// Devolve { lista, recuperado } ou null se não houver nenhum item completo.
export function decodificarAchado(conteudo) {
  const texto = paraTexto(conteudo).replace(/```(?:json)?/gi, '');
  const inicio = texto.indexOf('[');
  if (inicio === -1) return null;
  const fim = texto.lastIndexOf(']');
  if (fim > inicio) {
    try {
      const lido = JSON.parse(texto.slice(inicio, fim + 1));
      if (Array.isArray(lido)) return { lista: lido, recuperado: false };
    } catch {
      // cai para a recuperação abaixo
    }
  }
  const ultimoItem = texto.lastIndexOf('},');
  if (ultimoItem <= inicio) return null;
  try {
    const lido = JSON.parse(`${texto.slice(inicio, ultimoItem + 1)}]`);
    return Array.isArray(lido) && lido.length > 0 ? { lista: lido, recuperado: true } : null;
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [entrada, saida] = process.argv.slice(2);
  if (!entrada || !saida) {
    console.error('Uso: node ferramentas/importar/decodificar-achado.mjs entrada.txt saida.json');
    process.exit(2);
  }
  const r = decodificarAchado(readFileSync(entrada, 'utf8'));
  if (!r) {
    console.error('Não achei uma lista JSON de achados nesse conteúdo.');
    process.exit(1);
  }
  writeFileSync(saida, JSON.stringify(r.lista, null, 2));
  console.log(`${r.lista.length} achados lidos${r.recuperado ? ' (o fim do documento estava cortado: itens incompletos ficaram de fora)' : ''}.`);
}
