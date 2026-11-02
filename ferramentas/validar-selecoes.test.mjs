import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validarArquivoDeSelecoes } from './validar-selecoes.mjs';

const OK = {
  id: 'ufg-ppgadm-2027',
  programa: 'Administração (PPGADM)',
  instituicao: 'Universidade Federal de Goiás (UFG)',
  esfera: 'federal',
  area: 'administracao',
  niveis: ['mestrado', 'doutorado'],
  ingresso: '1º semestre de 2027',
  inscricoesDe: '2026-10-09',
  inscricoesAte: '2026-11-24',
  link: 'https://ppgadm.face.ufg.br/edital',
  fonte: 'Edital 01/2026',
};
const arquivo = (selecoes, extra = {}) => JSON.stringify({ conferidoEm: '2026-11-02', selecoes, ...extra });

test('aceita um arquivo correto, inclusive com áreas vizinhas e especialização', () => {
  const r = validarArquivoDeSelecoes(arquivo([OK, { ...OK, id: 'b', link: 'https://x.ufrgs.br/b', area: 'geografia', niveis: ['especializacao'] }]));
  assert.deepEqual(r, { total: 2, conferidoEm: '2026-11-02' });
});

test('aceita lista vazia', () => {
  assert.equal(validarArquivoDeSelecoes(arquivo([])).total, 0);
});

test('recusa o que o app descartaria', () => {
  assert.throws(() => validarArquivoDeSelecoes('{"selecoes":{}}'), /sem a lista/);
  assert.throws(() => validarArquivoDeSelecoes(JSON.stringify({ selecoes: [] })), /conferidoEm/);
  assert.throws(() => validarArquivoDeSelecoes(arquivo([{ ...OK, link: 'http://x.br' }])), /https/);
  assert.throws(() => validarArquivoDeSelecoes(arquivo([{ ...OK, esfera: 'privada' }])), /Esfera/);
  assert.throws(() => validarArquivoDeSelecoes(arquivo([{ ...OK, area: 'medicina' }])), /Área/);
  assert.throws(() => validarArquivoDeSelecoes(arquivo([{ ...OK, niveis: [] }])), /Níveis/);
  assert.throws(() => validarArquivoDeSelecoes(arquivo([{ ...OK, inscricoesAte: '24/11/2026' }])), /AAAA-MM-DD/);
  assert.throws(() => validarArquivoDeSelecoes(arquivo([{ ...OK, inscricoesDe: '2026-12-01' }])), /contradizem/);
  assert.throws(() => validarArquivoDeSelecoes(arquivo([OK, { ...OK, id: 'outro' }])), /Link repetido/);
  assert.throws(() => validarArquivoDeSelecoes(arquivo([OK, { ...OK, link: 'https://outro.br/x' }])), /id repetido/);
  assert.throws(() => validarArquivoDeSelecoes(arquivo([{ ...OK, fonte: '' }])), /fonte/);
});
