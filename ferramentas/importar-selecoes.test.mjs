import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lerRespostaDoChatGpt, linkExiste, mesclar, normalizarLink, slug, validarAchado } from './importar-selecoes.mjs';

const HOJE = '2026-10-29';
const ACHADO = {
  programa: 'Relações Internacionais',
  area: 'ri',
  instituicao: 'Universidade Federal de Pelotas (UFPel)',
  esfera: 'federal',
  niveis: ['mestrado'],
  ingresso: '1º semestre de 2027',
  inscricoesDe: '2026-11-03',
  inscricoesAte: '2026-12-10',
  link: 'https://wp.ufpel.edu.br/ri/edital-2027.pdf',
  fonte: 'Página do programa de RI da UFPel',
};

test('lerRespostaDoChatGpt aceita cerca de código e texto em volta, e recusa o que não é lista', () => {
  assert.deepEqual(lerRespostaDoChatGpt('Aqui vai:\n```json\n[{"a":1}]\n```\nPronto.'), [{ a: 1 }]);
  assert.equal(lerRespostaDoChatGpt('{"a":1}'), null);
  assert.equal(lerRespostaDoChatGpt('sem json'), null);
  assert.equal(lerRespostaDoChatGpt('[quebrado'), null);
});

test('validarAchado aceita um achado completo e marca a fonte como achada pelo ChatGPT, com a data', () => {
  const { selecao } = validarAchado(ACHADO, HOJE);
  assert.equal(selecao.esfera, 'federal');
  assert.deepEqual(selecao.niveis, ['mestrado']);
  assert.match(selecao.id, /^universidade-federal-de-pelotas-ufpel-relacoes-internacionais-1-semestre-de-2027$/);
  assert.match(selecao.fonte, /Achado com o ChatGPT em 29\/10\/2026; o edital não foi aberto pelo Hub RI/);
  assert.equal(selecao.fonte.includes('..'), false);
});

test('validarAchado diz quem achou: o ChatGPT por padrão, ou o nome dado', () => {
  assert.match(validarAchado(ACHADO, HOJE).selecao.fonte, /Achado com o ChatGPT em/);
  assert.match(validarAchado(ACHADO, HOJE, 'Claude').selecao.fonte, /Achado com Claude em 29\/10\/2026/);
  assert.match(mesclar([], [ACHADO], HOJE, 'Claude').lista[0].fonte, /Achado com Claude/);
});

test('validarAchado recusa o que está fora do formato, e diz o motivo', () => {
  const motivo = (mudanca) => validarAchado({ ...ACHADO, ...mudanca }, HOJE).motivo;
  assert.match(motivo({ esfera: 'particular' }), /federal.*estadual/);
  assert.match(motivo({ area: 'medicina' }), /área desconhecida/);
  assert.match(motivo({ niveis: ['graduacao'] }), /niveis/);
  assert.match(motivo({ niveis: 'mestrado' }), /niveis/);
  assert.match(motivo({ link: 'http://wp.ufpel.edu.br/x' }), /https/);
  assert.match(motivo({ link: 'https://exemplo.com/edital' }), /fora de domínio \.br/);
  assert.match(motivo({ fonte: '' }), /fonte/);
  assert.match(motivo({ programa: '' }), /programa ou instituição/);
  assert.match(motivo({ inscricoesAte: '10/12/2026' }), /AAAA-MM-DD/);
  assert.match(motivo({ inscricoesDe: '2026-12-20', inscricoesAte: '2026-12-10' }), /se contradizem/);
  assert.match(motivo({ inscricoesDe: '2026-02-31' }), /AAAA-MM-DD/);
  assert.match(validarAchado(null, HOJE).motivo, /não é um objeto/);
});

test('validarAchado aceita datas nulas, esfera em maiúscula e seleção encerrada há pouco, mas não a muito antiga', () => {
  assert.ok(validarAchado({ ...ACHADO, inscricoesDe: null, inscricoesAte: null, ingresso: null, esfera: 'Estadual' }, HOJE).selecao);
  assert.ok(validarAchado({ ...ACHADO, inscricoesDe: '2026-07-15', inscricoesAte: '2026-08-07' }, HOJE).selecao);
  assert.match(validarAchado({ ...ACHADO, inscricoesDe: '2025-01-01', inscricoesAte: '2025-02-01' }, HOJE).motivo, /encerrada há mais de 120 dias/);
});

test('normalizarLink ignora www, fragmento, rastreio e barra final; slug tira acento', () => {
  assert.equal(normalizarLink('https://www.ufpel.edu.br/x/?utm_source=a#topo'), normalizarLink('https://ufpel.edu.br/x'));
  assert.equal(normalizarLink('ftp://x.br'), null);
  assert.equal(slug('Relações Internacionais — 1º semestre'), 'relacoes-internacionais-1-semestre');
});

test('mesclar adiciona o novo, completa datas que faltavam, recusa repetido e não mexe no que já estava', () => {
  const existente = { id: 'x', programa: 'RI', area: 'ri', instituicao: 'UFU', esfera: 'federal', niveis: ['mestrado'], ingresso: null, inscricoesDe: null, inscricoesAte: null, link: 'https://ppgri.ufu.br/edital', fonte: 'f' };
  const r = mesclar(
    [existente],
    [
      ACHADO,
      { ...ACHADO, programa: 'Outro programa', link: 'https://ppgri.ufu.br/edital/', inscricoesDe: '2026-11-01', inscricoesAte: '2026-11-30', ingresso: '2027' },
      { ...ACHADO },
      { ...ACHADO, link: 'https://outro.ufpel.edu.br/mesmo-programa.pdf' },
      { ...ACHADO, esfera: 'particular', programa: 'Invalido' },
    ],
    HOJE,
  );
  assert.equal(r.adicionadas.length, 1);
  assert.equal(r.atualizadas.length, 1);
  assert.deepEqual(r.atualizadas[0].campos, ['inscricoesDe', 'inscricoesAte', 'ingresso']);
  assert.equal(r.lista.length, 2);
  assert.equal(r.lista[0].inscricoesAte, '2026-11-30');
  assert.equal(r.lista[0].programa, 'RI');
  const motivos = r.recusadas.map((x) => x.motivo).join(' | ');
  assert.match(motivos, /já está na lista/);
  assert.match(motivos, /mesmo programa e ingresso, com outro link/);
  assert.match(motivos, /federal.*estadual/);
  assert.equal(existente.inscricoesAte, null, 'a lista original não é alterada');
});

test('linkExiste recusa 404 e 410, e aceita o resto, inclusive erro de rede', async () => {
  const com = (status) => async () => ({ status });
  assert.equal(await linkExiste('https://x.br', com(200)), true);
  assert.equal(await linkExiste('https://x.br', com(403)), true);
  assert.equal(await linkExiste('https://x.br', com(404)), false);
  assert.equal(await linkExiste('https://x.br', com(410)), false);
  assert.equal(
    await linkExiste('https://x.br', async () => {
      throw new Error('rede');
    }),
    true,
  );
});
