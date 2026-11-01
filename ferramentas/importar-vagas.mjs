// Importa para o app as vagas de trabalho que a rotina de pesquisa (Claude na nuvem) ou outra pessoa achou.
// A ferramenta NÃO confia no que veio: confere cada vaga, recusa o que está fora do formato, não repete o mesmo link,
// recusa link de rede social e de agregador (só vale a página da própria organização) e marca quem achou e quando.
// Por padrão só mostra o resultado; com --aplicar grava em app/src/dados/vagas.json e limpa as vagas vencidas.
//
// Uso:
//   node ferramentas/importar/importar-vagas.mjs achados.json                    (só mostra)
//   node ferramentas/importar/importar-vagas.mjs achados.json --aplicar --por=Claude
//   node ferramentas/importar/importar-vagas.mjs achados.json --conferir-links    (recusa link que dá 404)

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lerRespostaDoChatGpt, linkExiste, normalizarLink, slug } from './importar-selecoes.mjs';

// Têm de bater com CAMPOS_DE_VAGA e TIPOS_DE_VAGA em app/src/dominio/vagas.ts.
export const CAMPOS = ['diplomacia', 'comercio-exterior', 'organismos', 'analise', 'academia', 'seguranca', 'comunicacao'];
export const TIPOS = ['estagio', 'trainee', 'efetivo', 'consultoria', 'voluntariado', 'concurso', 'outro'];

// Redes sociais, mensageiros e sites de terceiros que republicam vagas: não valem como link oficial.
export const DOMINIOS_RECUSADOS = [
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'tiktok.com',
  'youtube.com',
  't.me',
  'wa.me',
  'whatsapp.com',
  'drive.google.com',
  'docs.google.com',
  'unvacancies.com',
  'impactpool.org',
  'untalent.org',
  'indeed.com',
  'glassdoor.com',
  'jooble.org',
  'vagas.com.br',
  'infojobs.com.br',
  'catho.com.br',
];

const DIA_EM_MS = 24 * 60 * 60 * 1000;
// Mesmos números do app (DIAS_SEM_PRAZO): a limpeza só tira o que o app já esconde há um tempo.
const DIAS_SEM_PRAZO = 30;
const DIAS_DEPOIS_DE_VENCER = 14;

function texto(valor) {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

function diaValido(valor) {
  const t = texto(valor);
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const data = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== t ? null : t;
}

function diasEntre(de, ate) {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_EM_MS);
}

export function dominioRecusado(host) {
  const h = host.toLowerCase().replace(/^www\./, '');
  return DOMINIOS_RECUSADOS.find((d) => h === d || h.endsWith(`.${d}`)) ?? null;
}

// Confere uma vaga. Devolve { vaga } pronta para gravar, ou { motivo }.
export function validarVaga(bruto, hoje, por = 'Claude') {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return { motivo: 'o item não é um objeto' };
  const o = bruto;
  const titulo = texto(o.titulo);
  const organizacao = texto(o.organizacao);
  const rotulo = `${titulo ?? '(sem título)'} / ${organizacao ?? '(sem organização)'}`;
  if (!titulo || !organizacao) return { motivo: 'falta título ou organização', rotulo };
  const campo = CAMPOS.find((c) => c === o.campo);
  if (!campo) return { motivo: `campo desconhecido (use: ${CAMPOS.join(', ')})`, rotulo };
  const tipo = TIPOS.find((t) => t === o.tipo);
  if (!tipo) return { motivo: `tipo desconhecido (use: ${TIPOS.join(', ')})`, rotulo };
  const link = texto(o.link);
  if (!link || !/^https:\/\/[^\s]+$/.test(link)) return { motivo: 'link ausente ou sem https', rotulo };
  let host;
  try {
    host = new URL(link).hostname;
  } catch {
    return { motivo: 'link inválido', rotulo };
  }
  const barrado = dominioRecusado(host);
  if (barrado) return { motivo: `link de ${barrado}: use a página de vagas da própria organização`, rotulo };
  const fonteDada = texto(o.fonte);
  if (!fonteDada) return { motivo: 'falta dizer de onde veio (fonte)', rotulo };

  if ((o.prazo ?? null) !== null && diaValido(o.prazo) === null) return { motivo: 'prazo precisa ser AAAA-MM-DD ou null', rotulo };
  const prazo = diaValido(o.prazo);
  if (prazo && diasEntre(hoje, prazo) < 0) return { motivo: `prazo já passou (${prazo})`, rotulo };
  if (o.remoto !== undefined && o.remoto !== null && typeof o.remoto !== 'boolean') return { motivo: 'remoto precisa ser true ou false', rotulo };

  const [d, m, a] = [hoje.slice(8, 10), hoje.slice(5, 7), hoje.slice(0, 4)];
  return {
    vaga: {
      id: slug(`${organizacao}-${titulo}-${prazo ?? hoje}`),
      titulo,
      organizacao,
      campo,
      tipo,
      local: texto(o.local),
      remoto: o.remoto === true,
      prazo,
      contrato: texto(o.contrato),
      nota: texto(o.nota),
      link,
      fonte: `${fonteDada.replace(/\.+$/, '')}. Achada com ${por} em ${d}/${m}/${a}; confira no anúncio`,
      vistaEm: hoje,
    },
  };
}

// Junta os achados na lista que já existe. Mesmo link = mesma vaga: só completa o prazo que faltava. Mesmo id com link novo é recusado.
export function mesclarVagas(existentes, achados, hoje, por = 'Claude') {
  const lista = existentes.map((v) => ({ ...v }));
  const resultado = { adicionadas: [], atualizadas: [], recusadas: [] };
  const porLink = new Map(lista.map((v) => [normalizarLink(v.link), v]));
  const ids = new Set(lista.map((v) => v.id));
  for (const bruto of achados) {
    const r = validarVaga(bruto, hoje, por);
    if (!r.vaga) {
      resultado.recusadas.push({ rotulo: r.rotulo ?? '(item inválido)', motivo: r.motivo });
      continue;
    }
    const v = r.vaga;
    const igual = porLink.get(normalizarLink(v.link));
    if (igual) {
      if (v.prazo && !igual.prazo) {
        igual.prazo = v.prazo;
        resultado.atualizadas.push({ rotulo: `${v.titulo} / ${v.organizacao}`, campos: ['prazo'] });
      } else {
        resultado.recusadas.push({ rotulo: `${v.titulo} / ${v.organizacao}`, motivo: 'já está na lista (mesmo link) e não traz dado novo' });
      }
      continue;
    }
    if (ids.has(v.id)) {
      resultado.recusadas.push({ rotulo: `${v.titulo} / ${v.organizacao}`, motivo: 'já existe uma vaga com o mesmo título, organização e prazo, com outro link: confira à mão' });
      continue;
    }
    ids.add(v.id);
    porLink.set(normalizarLink(v.link), v);
    lista.push(v);
    resultado.adicionadas.push({ rotulo: `${v.titulo} / ${v.organizacao}`, id: v.id });
  }
  return { lista, ...resultado };
}

// Tira da lista o que o app já esconde: vencida há mais de 14 dias, ou sem prazo e vista há mais de 30.
export function limpar(lista, hoje) {
  const mantidas = [];
  const removidas = [];
  for (const v of lista) {
    const velha = v.prazo ? diasEntre(v.prazo, hoje) > DIAS_DEPOIS_DE_VENCER : diasEntre(v.vistaEm, hoje) > DIAS_SEM_PRAZO + DIAS_DEPOIS_DE_VENCER;
    (velha ? removidas : mantidas).push(v);
  }
  return { mantidas, removidas };
}

async function principal(args) {
  const arquivo = args.find((a) => !a.startsWith('--'));
  const aplicar = args.includes('--aplicar');
  const conferirLinks = args.includes('--conferir-links');
  const porArg = args.find((a) => a.startsWith('--por='));
  const por = porArg ? porArg.slice('--por='.length).trim() || 'Claude' : 'Claude';
  if (!arquivo) {
    console.error('Uso: node ferramentas/importar/importar-vagas.mjs achados.json [--aplicar] [--conferir-links] [--por=Claude]');
    process.exitCode = 1;
    return;
  }
  const hoje = new Date().toISOString().slice(0, 10);
  const lista = lerRespostaDoChatGpt(readFileSync(arquivo, 'utf8'));
  if (!lista) {
    console.error('Não achei uma lista JSON no arquivo. O arquivo precisa conter só o array, no formato de ferramentas/rotina/PEDIDO-DA-ROTINA.md.');
    process.exitCode = 1;
    return;
  }
  // HUBRI_VAGAS aponta para outro vagas.json (a rotina na nuvem trabalha no repositório de dados, onde o arquivo fica na raiz).
  const destino = process.env.HUBRI_VAGAS ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'src', 'dados', 'vagas.json');
  const dados = JSON.parse(readFileSync(destino, 'utf8'));

  let achados = lista;
  const semLink = [];
  if (conferirLinks) {
    achados = [];
    for (const item of lista) {
      const link = typeof item?.link === 'string' ? item.link : null;
      if (link && !(await linkExiste(link))) semLink.push({ rotulo: `${item.titulo ?? '?'} / ${item.organizacao ?? '?'}`, motivo: `o link não existe (404): ${link}` });
      else achados.push(item);
    }
  }

  const r = mesclarVagas(dados.vagas, achados, hoje, por);
  r.recusadas.push(...semLink);
  const { mantidas, removidas } = limpar(r.lista, hoje);
  console.log(`Adicionadas: ${r.adicionadas.length} | Atualizadas: ${r.atualizadas.length} | Recusadas: ${r.recusadas.length} | Removidas por vencimento: ${removidas.length}`);
  for (const a of r.adicionadas) console.log(`  + ${a.rotulo}`);
  for (const a of r.atualizadas) console.log(`  ~ ${a.rotulo} (${a.campos.join(', ')})`);
  for (const a of r.recusadas) console.log(`  x ${a.rotulo}: ${a.motivo}`);
  for (const v of removidas) console.log(`  - ${v.titulo} / ${v.organizacao} (vencida)`);
  if (!aplicar) {
    console.log('\nNada foi gravado. Rode de novo com --aplicar para gravar.');
    return;
  }
  if (r.adicionadas.length === 0 && r.atualizadas.length === 0 && removidas.length === 0) {
    console.log('\nNada a gravar.');
    return;
  }
  if (existsSync(destino)) copyFileSync(destino, `${destino}.bak`);
  writeFileSync(destino, `${JSON.stringify({ ...dados, conferidoEm: hoje, vagas: mantidas }, null, 2)}\n`);
  console.log(`\nGravado em ${destino} (cópia do anterior em .bak). Rode os testes do app e peça um novo APK.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal(process.argv.slice(2));
}
