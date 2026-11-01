import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodificarAchado } from './decodificar-achado.mjs';

const itens = [{ titulo: 'A', link: 'https://a.org/1' }, { titulo: 'B', link: 'https://b.org/2' }];
const json = JSON.stringify(itens, null, 2);

test('lê texto simples, com BOM e cerca de código', () => {
  assert.deepEqual(decodificarAchado(`﻿\`\`\`json\n${json}\n\`\`\``), { lista: itens, recuperado: false });
});

test('lê base64 do documento', () => {
  const b64 = Buffer.from(`﻿${json}`, 'utf8').toString('base64');
  assert.deepEqual(decodificarAchado(b64), { lista: itens, recuperado: false });
});

test('aproveita os itens completos quando o fim veio cortado', () => {
  const cortado = '[\r\n{"titulo":"A","link":"https://a.org/1"},\r\n{"titulo":"B","link":"https://b.or';
  const r = decodificarAchado(Buffer.from(cortado, 'utf8').toString('base64'));
  assert.equal(r.recuperado, true);
  assert.deepEqual(r.lista, [{ titulo: 'A', link: 'https://a.org/1' }]);
});

test('base64 cortado fora do bloco de 4 não quebra', () => {
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  const r = decodificarAchado(b64.slice(0, b64.length - 7));
  assert.equal(r?.recuperado, true);
  assert.deepEqual(r?.lista, [itens[0]]);
});

test('devolve null quando não há lista', () => {
  assert.equal(decodificarAchado('nada de json aqui, só conversa'), null);
  assert.equal(decodificarAchado(''), null);
});
