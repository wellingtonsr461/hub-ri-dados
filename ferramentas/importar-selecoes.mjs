// Importa para o app as seleções de mestrado e doutorado que o ChatGPT (ou outra pessoa) achou, sem gastar com API.
// Fluxo: você pede ao ChatGPT usando docs/PEDIR-AO-CHATGPT.md, salva a resposta num arquivo e roda esta ferramenta.
// A ferramenta NÃO confia no que veio: confere cada item, recusa o que está fora do formato, não repete o que já existe e marca a fonte
// como "achado com o ChatGPT, conferir o edital". Por padrão só mostra o resultado; com --aplicar grava em app/src/dados/selecoes-pos.json.
//
// Uso:
//   node ferramentas/importar/importar-selecoes.mjs achados.json              (só mostra)
//   node ferramentas/importar/importar-selecoes.mjs achados.json --aplicar     (grava)
//   node ferramentas/importar/importar-selecoes.mjs achados.json --conferir-links   (abre cada link e recusa os que dão 404)
//   node ferramentas/importar/importar-selecoes.mjs achados.json --por=Claude         (a fonte diz "Achado com Claude" em vez de "o ChatGPT")

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Quem é de RI também faz pós em áreas vizinhas: por isso a lista vai além de RI (mesmas áreas de app/src/dominio/selecoes-pos.ts).
export const AREAS = [
  'ri',
  'ciencia-politica',
  'economia',
  'direito',
  'administracao',
  'geografia',
  'historia',
  'ciencias-sociais',
  'comunicacao-letras',
  'meio-ambiente',
  'politicas-publicas',
  'defesa-seguranca',
];
export const ESFERAS = ['federal', 'estadual'];
export const NIVEIS = ['mestrado', 'doutorado', 'especializacao'];

const DIA_EM_MS = 24 * 60 * 60 * 1000;
// Seleção encerrada há mais que isto não ajuda ninguém e fica de fora.
const DIAS_DE_TOLERANCIA = 120;

function texto(valor) {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

function diaValido(valor) {
  const t = texto(valor);
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const data = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== t ? null : t;
}

// Tira bloco de código e texto solto em volta e devolve a lista, ou null se não for um array JSON.
export function lerRespostaDoChatGpt(conteudo) {
  const semCerca = String(conteudo).replace(/```(?:json)?/gi, '');
  const inicio = semCerca.indexOf('[');
  const fim = semCerca.lastIndexOf(']');
  if (inicio === -1 || fim <= inicio) return null;
  try {
    const lido = JSON.parse(semCerca.slice(inicio, fim + 1));
    return Array.isArray(lido) ? lido : null;
  } catch {
    return null;
  }
}

// Mesma ideia do app: sem www, sem #fragmento, sem rastreio, sem barra final.
export function normalizarLink(url) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !/^(utm_|gclid|fbclid|ref$)/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${host}${u.pathname.replace(/\/+$/, '')}${params ? `?${params}` : ''}`;
}

export function slug(t) {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

// Confere um item. Devolve { selecao } pronto para gravar, ou { motivo }.
export function validarAchado(bruto, hoje, por = 'o ChatGPT') {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return { motivo: 'o item não é um objeto' };
  const o = bruto;
  const programa = texto(o.programa);
  const instituicao = texto(o.instituicao);
  const link = texto(o.link);
  const fonteDada = texto(o.fonte);
  const esfera = ESFERAS.find((e) => e === String(o.esfera ?? '').toLowerCase());
  const area = AREAS.find((a) => a === o.area);
  const niveis = Array.isArray(o.niveis) ? [...new Set(o.niveis.filter((n) => NIVEIS.includes(n)))] : [];
  const rotulo = `${programa ?? '(sem programa)'} / ${instituicao ?? '(sem instituição)'}`;
  if (!programa || !instituicao) return { motivo: 'falta programa ou instituição', rotulo };
  if (!esfera) return { motivo: 'esfera precisa ser "federal" ou "estadual" (só universidades públicas)', rotulo };
  if (!area) return { motivo: `área desconhecida (use: ${AREAS.join(', ')})`, rotulo };
  if (niveis.length === 0) return { motivo: 'niveis precisa ser uma lista com "mestrado", "doutorado" e/ou "especializacao"', rotulo };
  if (!link || !/^https:\/\/[^\s]+$/.test(link)) return { motivo: 'link ausente ou sem https', rotulo };
  let host;
  try {
    host = new URL(link).hostname.toLowerCase();
  } catch {
    return { motivo: 'link inválido', rotulo };
  }
  if (!host.endsWith('.br')) return { motivo: `link fora de domínio .br (${host}): use a página do programa ou da universidade`, rotulo };
  if (!fonteDada) return { motivo: 'falta dizer de onde veio (fonte)', rotulo };

  const de = diaValido(o.inscricoesDe);
  const ate = diaValido(o.inscricoesAte);
  if ((o.inscricoesDe ?? null) !== null && de === null) return { motivo: 'inscricoesDe precisa ser AAAA-MM-DD ou null', rotulo };
  if ((o.inscricoesAte ?? null) !== null && ate === null) return { motivo: 'inscricoesAte precisa ser AAAA-MM-DD ou null', rotulo };
  if (de && ate && de > ate) return { motivo: 'as datas se contradizem (começo depois do fim)', rotulo };
  if (ate && (Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${ate}T00:00:00Z`)) / DIA_EM_MS > DIAS_DE_TOLERANCIA) {
    return { motivo: `encerrada há mais de ${DIAS_DE_TOLERANCIA} dias (${ate})`, rotulo };
  }

  const ingresso = texto(o.ingresso);
  const id = slug(`${instituicao}-${programa}-${ingresso ?? ate?.slice(0, 4) ?? hoje.slice(0, 4)}`);
  const [d, m, a] = [hoje.slice(8, 10), hoje.slice(5, 7), hoje.slice(0, 4)];
  return {
    selecao: {
      id,
      programa,
      area,
      instituicao,
      esfera,
      niveis,
      ingresso,
      inscricoesDe: de,
      inscricoesAte: ate,
      link,
      fonte: `${fonteDada.replace(/\.+$/, '')}. Achado com ${por} em ${d}/${m}/${a}; o edital não foi aberto pelo Hub RI: confira as datas nele`,
    },
  };
}

// Tira da lista a seleção cujas inscrições terminaram há mais que a tolerância: o app não precisa mostrar o que passou faz meses.
export function limparVencidas(lista, hoje) {
  const manter = [];
  const removidas = [];
  for (const s of lista) {
    const vencida = s.inscricoesAte && (Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${s.inscricoesAte}T00:00:00Z`)) / DIA_EM_MS > DIAS_DE_TOLERANCIA;
    (vencida ? removidas : manter).push(s);
  }
  return { lista: manter, removidas };
}

// Junta os achados na lista que já existe. Mesmo link = mesma seleção: só completa as datas que faltavam. Mesmo id com link novo é recusado.
export function mesclar(existentes, achados, hoje, por = 'o ChatGPT') {
  const lista = existentes.map((s) => ({ ...s }));
  const resultado = { adicionadas: [], atualizadas: [], recusadas: [] };
  const porLink = new Map(lista.map((s) => [normalizarLink(s.link), s]));
  const ids = new Set(lista.map((s) => s.id));
  for (const bruto of achados) {
    const v = validarAchado(bruto, hoje, por);
    if (!v.selecao) {
      resultado.recusadas.push({ rotulo: v.rotulo ?? '(item inválido)', motivo: v.motivo });
      continue;
    }
    const s = v.selecao;
    const igual = porLink.get(normalizarLink(s.link));
    if (igual) {
      const mudou = [];
      for (const campo of ['inscricoesDe', 'inscricoesAte', 'ingresso']) {
        if (s[campo] && !igual[campo]) {
          igual[campo] = s[campo];
          mudou.push(campo);
        }
      }
      if (mudou.length > 0) resultado.atualizadas.push({ rotulo: `${s.programa} / ${s.instituicao}`, campos: mudou });
      else resultado.recusadas.push({ rotulo: `${s.programa} / ${s.instituicao}`, motivo: 'já está na lista (mesmo link) e não traz dado novo' });
      continue;
    }
    if (ids.has(s.id)) {
      resultado.recusadas.push({ rotulo: `${s.programa} / ${s.instituicao}`, motivo: 'já existe uma seleção com o mesmo programa e ingresso, com outro link: confira à mão' });
      continue;
    }
    ids.add(s.id);
    porLink.set(normalizarLink(s.link), s);
    lista.push(s);
    resultado.adicionadas.push({ rotulo: `${s.programa} / ${s.instituicao}`, id: s.id });
  }
  return { lista, ...resultado };
}

// 404 e 410 = a página não existe. Qualquer outra resposta (ou falha de rede) não prova nada e não derruba o item.
export async function linkExiste(link, buscar = fetch) {
  try {
    const r = await buscar(link, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { Accept: 'text/html,application/pdf' } });
    return !(r.status === 404 || r.status === 410);
  } catch {
    return true;
  }
}

async function principal(args) {
  const arquivo = args.find((a) => !a.startsWith('--'));
  const aplicar = args.includes('--aplicar');
  const conferirLinks = args.includes('--conferir-links');
  // Quem achou, para a fonte de cada item: --por=Claude (rotina na nuvem). Sem a opção, "o ChatGPT".
  const porArg = args.find((a) => a.startsWith('--por='));
  const por = porArg ? porArg.slice('--por='.length).trim() || 'o ChatGPT' : 'o ChatGPT';
  if (!arquivo) {
    console.error('Uso: node ferramentas/importar/importar-selecoes.mjs achados.json [--aplicar] [--conferir-links] [--por=Claude]');
    process.exitCode = 1;
    return;
  }
  const hoje = new Date().toISOString().slice(0, 10);
  const lista = lerRespostaDoChatGpt(readFileSync(arquivo, 'utf8'));
  if (!lista) {
    console.error('Não achei uma lista JSON no arquivo. Peça ao ChatGPT de novo, só com o array, como em docs/PEDIR-AO-CHATGPT.md.');
    process.exitCode = 1;
    return;
  }
  // HUBRI_SELECOES aponta para outro selecoes-pos.json (a rotina na nuvem trabalha no repositório de dados, onde o arquivo fica na raiz).
  const destino = process.env.HUBRI_SELECOES ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'src', 'dados', 'selecoes-pos.json');
  const dados = JSON.parse(readFileSync(destino, 'utf8'));

  let achados = lista;
  const semLink = [];
  if (conferirLinks) {
    achados = [];
    for (const item of lista) {
      const link = typeof item?.link === 'string' ? item.link : null;
      if (link && !(await linkExiste(link))) semLink.push({ rotulo: `${item.programa ?? '?'} / ${item.instituicao ?? '?'}`, motivo: `o link não existe (404): ${link}` });
      else achados.push(item);
    }
  }

  const r = mesclar(dados.selecoes, achados, hoje, por);
  const limpa = limparVencidas(r.lista, hoje);
  r.lista = limpa.lista;
  r.recusadas.push(...semLink);
  console.log(`Adicionadas: ${r.adicionadas.length} | Atualizadas: ${r.atualizadas.length} | Recusadas: ${r.recusadas.length} | Removidas por vencimento: ${limpa.removidas.length}`);
  for (const a of limpa.removidas) console.log(`  - ${a.programa} / ${a.instituicao} (encerrada em ${a.inscricoesAte})`);
  for (const a of r.adicionadas) console.log(`  + ${a.rotulo}`);
  for (const a of r.atualizadas) console.log(`  ~ ${a.rotulo} (${a.campos.join(', ')})`);
  for (const a of r.recusadas) console.log(`  x ${a.rotulo}: ${a.motivo}`);
  if (!aplicar) {
    console.log('\nNada foi gravado. Rode de novo com --aplicar para gravar.');
    return;
  }
  if (r.adicionadas.length === 0 && r.atualizadas.length === 0 && limpa.removidas.length === 0) {
    console.log('\nNada a gravar.');
    return;
  }
  if (existsSync(destino)) copyFileSync(destino, `${destino}.bak`);
  writeFileSync(destino, `${JSON.stringify({ ...dados, conferidoEm: hoje, selecoes: r.lista }, null, 2)}\n`);
  console.log(`\nGravado em ${destino} (cópia do anterior em .bak). Rode os testes do app e peça um novo APK.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal(process.argv.slice(2));
}
