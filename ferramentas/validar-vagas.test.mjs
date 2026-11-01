import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validarArquivoDeVagas } from './validar-vagas.mjs';

const vaga = { titulo: 'A', link: 'https://a.org/1', campo: 'organismos', tipo: 'estagio' };
const arquivo = (vagas) => JSON.stringify({ conferidoEm: '2026-11-01', vagas });

test('aceita arquivo certo e lista vazia', () => {
  assert.deepEqual(validarArquivoDeVagas(arquivo([vaga])), { total: 1, conferidoEm: '2026-11-01' });
  assert.equal(validarArquivoDeVagas(arquivo([])).total, 0);
});

test('recusa o que não serve para publicar', () => {
  assert.throws(() => validarArquivoDeVagas('[]'), /lista "vagas"/);
  assert.throws(() => validarArquivoDeVagas(JSON.stringify({ vagas: [] })), /conferidoEm/);
  assert.throws(() => validarArquivoDeVagas(arquivo([{ ...vaga, link: 'http://a.org' }])), /link https/);
  assert.throws(() => validarArquivoDeVagas(arquivo([{ ...vaga, link: 'https://www.linkedin.com/jobs/1' }])), /recusado/);
  assert.throws(() => validarArquivoDeVagas(arquivo([vaga, vaga])), /repetido/);
  assert.throws(() => validarArquivoDeVagas(arquivo([{ ...vaga, campo: 'outra' }])), /Campo inválido/);
  assert.throws(() => validarArquivoDeVagas(arquivo([{ ...vaga, tipo: 'outro-tipo' }])), /Tipo inválido/);
  assert.throws(() => validarArquivoDeVagas('não é json'));
});
