import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CAMPOS, TIPOS, dominioRecusado, limpar, mesclarVagas, validarVaga } from './importar-vagas.mjs';

const HOJE = '2026-10-29';
const ACHADO = {
  titulo: 'Estagiário(a) de pesquisa',
  organizacao: 'OMC',
  campo: 'comercio-exterior',
  tipo: 'estagio',
  local: 'Genebra, Suíça',
  remoto: false,
  prazo: '2026-11-20',
  contrato: '6 meses',
  nota: 'Programa de estágio para quem está cursando mestrado',
  link: 'https://jobs.wto.org/vaga/1',
  fonte: 'Página de carreiras da OMC',
};


test('validarVaga aceita uma vaga completa e marca quem achou e quando', () => {
  const { vaga } = validarVaga(ACHADO, HOJE, 'Claude');
  assert.equal(vaga.campo, 'comercio-exterior');
  assert.equal(vaga.vistaEm, HOJE);
  assert.match(vaga.fonte, /Achada com Claude em 29\/10\/2026; confira no anúncio/);
  assert.match(vaga.id, /^omc-estagiario-a-de-pesquisa-2026-11-20$/);
});

test('validarVaga recusa o que está fora do formato, e diz o motivo', () => {
  const motivo = (mudanca) => validarVaga({ ...ACHADO, ...mudanca }, HOJE).motivo;
  assert.match(motivo({ campo: 'medicina' }), /campo desconhecido/);
  assert.match(motivo({ tipo: 'freela' }), /tipo desconhecido/);
  assert.match(motivo({ link: 'http://jobs.wto.org/x' }), /https/);
  assert.match(motivo({ link: 'https://www.linkedin.com/jobs/view/1' }), /linkedin\.com/);
  assert.match(motivo({ link: 'https://br.indeed.com/vaga' }), /indeed\.com/);
  assert.match(motivo({ fonte: '' }), /fonte/);
  assert.match(motivo({ titulo: '' }), /título ou organização/);
  assert.match(motivo({ prazo: '20/11/2026' }), /AAAA-MM-DD/);
  assert.match(motivo({ prazo: '2026-10-01' }), /já passou/);
  assert.match(motivo({ remoto: 'sim' }), /remoto/);
  assert.match(validarVaga(null, HOJE).motivo, /não é um objeto/);
});

test('validarVaga aceita prazo nulo, remoto e campos opcionais vazios', () => {
  const { vaga } = validarVaga({ ...ACHADO, prazo: null, remoto: true, local: null, contrato: null, nota: null }, HOJE);
  assert.equal(vaga.prazo, null);
  assert.equal(vaga.remoto, true);
  assert.equal(vaga.local, null);
});

test('dominioRecusado pega subdomínio e www, mas não confunde domínio parecido', () => {
  assert.equal(dominioRecusado('www.linkedin.com'), 'linkedin.com');
  assert.equal(dominioRecusado('br.indeed.com'), 'indeed.com');
  assert.equal(dominioRecusado('jobs.wto.org'), null);
  assert.equal(dominioRecusado('notlinkedin.com'), null);
});

test('mesclarVagas adiciona o novo, completa o prazo que faltava, recusa repetido e não altera a lista original', () => {
  const existente = { ...validarVaga({ ...ACHADO, prazo: null, link: 'https://jobs.unicef.org/v/2', titulo: 'Assistente', organizacao: 'UNICEF' }, HOJE).vaga };
  const r = mesclarVagas(
    [existente],
    [
      ACHADO,
      { ...ACHADO },
      { ...ACHADO, titulo: 'Assistente', organizacao: 'UNICEF', link: 'https://jobs.unicef.org/v/2/', prazo: '2026-12-01' },
      { ...ACHADO, link: 'https://outro.org/mesma-vaga' },
      { ...ACHADO, campo: 'medicina', titulo: 'Inválida' },
    ],
    HOJE,
  );
  assert.equal(r.adicionadas.length, 1);
  assert.equal(r.atualizadas.length, 1);
  assert.deepEqual(r.atualizadas[0].campos, ['prazo']);
  assert.equal(r.lista.length, 2);
  const motivos = r.recusadas.map((x) => x.motivo).join(' | ');
  assert.match(motivos, /já está na lista/);
  assert.match(motivos, /mesmo título, organização e prazo, com outro link/);
  assert.match(motivos, /campo desconhecido/);
  assert.equal(existente.prazo, null, 'a lista original não é alterada');
});

test('limpar tira a vencida há mais de 14 dias e a sem prazo vista há mais de 44, e mantém o resto', () => {
  const v = (id, prazo, vistaEm) => ({ id, prazo, vistaEm });
  const { mantidas, removidas } = limpar(
    [v('recente', '2026-10-20', '2026-10-01'), v('vencida', '2026-10-10', '2026-09-01'), v('sem-prazo-nova', null, '2026-10-01'), v('sem-prazo-velha', null, '2026-09-10'), v('aberta', '2026-11-30', '2026-10-29')],
    HOJE,
  );
  assert.deepEqual(mantidas.map((x) => x.id), ['recente', 'sem-prazo-nova', 'aberta']);
  assert.deepEqual(removidas.map((x) => x.id), ['vencida', 'sem-prazo-velha']);
});
