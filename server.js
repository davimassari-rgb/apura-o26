// Painel de Apuração – Eleições 2026
// Servidor local sem dependências: faz proxy dos arquivos oficiais do TSE
// (resultados.tse.jus.br), mantém um cache curto e agrega os dados por região.

const http = require('http');
const https = require('https');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
// Na Vercel cada requisição roda numa função: sem processos em segundo plano, sem conexões
// longas e sem gravar no disco do projeto. Nesse modo os arquivos do TSE são reconferidos
// sob demanda (ETag) e o navegador consulta a cada poucos segundos em vez de usar SSE.
const SERVERLESS = !!process.env.VERCEL;
const FRESCOR_SERVERLESS_MS = 5_000;
const TSE_BASE = 'https://resultados.tse.jus.br/oficial/ele2026';

// Códigos oficiais do pleito 2026 (fonte: /oficial/comum/config/ele-c.json)
const ELEICOES = {
  federal: '6257',   // Presidente
  estadual: '6259',  // Governador, Senador, Deputados
};
const CARGOS = {
  1: { nome: 'Presidente', eleicao: ELEICOES.federal },
  3: { nome: 'Governador', eleicao: ELEICOES.estadual },
  5: { nome: 'Senador', eleicao: ELEICOES.estadual },
  6: { nome: 'Deputado Federal', eleicao: ELEICOES.estadual, proporcional: true },
  7: { nome: 'Deputado Estadual', eleicao: ELEICOES.estadual, proporcional: true },
  8: { nome: 'Deputado Distrital', eleicao: ELEICOES.estadual, proporcional: true },
};
// No DF, a Câmara Legislativa (Distrital, cargo 8) faz o papel de Deputado Estadual (7)
const cargoNaUF = (cargo, uf) => (cargo === 7 && uf === 'df' ? 8 : cargo);

const REGIOES = {
  norte:         { nome: 'Norte',        ufs: ['ac', 'ap', 'am', 'pa', 'ro', 'rr', 'to'] },
  nordeste:      { nome: 'Nordeste',     ufs: ['al', 'ba', 'ce', 'ma', 'pb', 'pe', 'pi', 'rn', 'se'] },
  'centro-oeste':{ nome: 'Centro-Oeste', ufs: ['df', 'go', 'mt', 'ms'] },
  sudeste:       { nome: 'Sudeste',      ufs: ['es', 'mg', 'rj', 'sp'] },
  sul:           { nome: 'Sul',          ufs: ['pr', 'rs', 'sc'] },
};
const UFS = Object.values(REGIOES).flatMap(r => r.ufs);

// ---------- utilidades ----------
const num = v => {
  if (v === undefined || v === null || v === '') return 0;
  return Number(String(v).replace(/\./g, '').replace(',', '.')) || 0;
};
const pad4 = n => String(n).padStart(4, '0');
const pad6 = n => String(n).padStart(6, '0');

function arquivoResultado(uf, cargo) {
  cargo = cargoNaUF(cargo, uf);
  const ele = CARGOS[cargo].eleicao;
  return `${TSE_BASE}/${ele}/dados/${uf}/${uf}-c${pad4(cargo)}-e${pad6(ele)}-u.json`;
}

// ---------- monitor de arquivos do TSE ----------
// Cada arquivo é reconsultado no instante em que o CDN do TSE o renova (cabeçalho Expires),
// com requisição condicional (ETag -> 304 quando nada mudou). Quando o conteúdo muda,
// os navegadores conectados são avisados na hora via Server-Sent Events (/api/eventos).
const arquivos = new Map();          // url -> estado do arquivo monitorado
const SEMPRE = /-c0001-e006257-u\.json$/; // Presidente: monitorado o tempo todo
const OCIOSO_MS = 10 * 60_000;       // para de monitorar o que ninguém consulta há 10 min
const assinantes = new Set();        // respostas SSE abertas

const cargoDaUrl = url => { const c = Number((url.match(/-c(\d{4})-/) || [])[1]); return c === 8 ? 7 : c; };

function fetchTSE(url) {
  let a = arquivos.get(url);
  if (!a) {
    a = { url, v: null, etag: null, timer: null, verificadoEm: 0, mudouEm: 0, expira: 0, primeira: null, vistoEm: Date.now() };
    arquivos.set(url, a);
    a.primeira = verificar(a);
  }
  a.vistoEm = Date.now();
  if (SERVERLESS && a.v && Date.now() - a.verificadoEm > FRESCOR_SERVERLESS_MS) {
    // sob demanda: reconfere (304 barato) e reaproveita uma verificação já em andamento
    a.emCurso ||= verificar(a).finally(() => { a.emCurso = null; });
    return a.emCurso.then(() => a.v);
  }
  return a.v ? Promise.resolve(a.v) : a.primeira.then(() => a.v);
}

async function verificar(a) {
  clearTimeout(a.timer);
  let proxima = 10_000;
  try {
    const r = await fetch(a.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (painel-apuracao-local)', ...(a.etag ? { 'If-None-Match': a.etag } : {}) },
      signal: AbortSignal.timeout(12_000),
    });
    a.verificadoEm = Date.now();
    a.consultas = (a.consultas || 0) + 1;
    if (r.status === 304) a.r304 = (a.r304 || 0) + 1;
    const expires = Date.parse(r.headers.get('expires') || '');
    if (Number.isFinite(expires)) { a.expira = expires; proxima = expires - Date.now() + 1000; }
    if (r.status === 200) {
      const etag = r.headers.get('etag');
      const data = await r.json();
      if (!a.v?.ok || etag !== a.etag) {
        a.etag = etag;
        a.v = { ok: true, data, geradoTSE: `${data.dg || ''} ${data.hg || ''}`.trim() };
        a.mudouEm = Date.now();
        avisar(a.url);
      }
    } else if (r.status !== 304) {
      if (!a.v?.ok) a.v = { ok: false, status: r.status };
      proxima = 20_000;
    }
  } catch (e) {
    a.erros = (a.erros || 0) + 1; a.ultimoErro = e.message;
    if (!a.v?.ok) a.v = { ok: false, status: 0, erro: e.message };
    proxima = 5_000;
  }
  // O CDN tem várias bordas com expirações diferentes; confiar só no Expires faz perder
  // ciclos inteiros. Então há um teto curto: arquivo nacional a cada 4 s, arquivos em uso
  // na tela a cada 8 s, demais a cada 30 s. Com ETag, a resposta "sem mudança" é um 304 vazio.
  const emUso = Date.now() - a.vistoEm < 90_000;
  const teto = a.url.includes('/br/br-') ? 4_000 : emUso ? 8_000 : 30_000;
  proxima = Math.min(teto, Math.max(2_000, proxima));
  a.proximaEm = Date.now() + proxima;
  if (SERVERLESS) return; // sem agendamento: a próxima requisição reconfere
  if (SEMPRE.test(a.url) || Date.now() - a.vistoEm < OCIOSO_MS) a.timer = setTimeout(() => verificar(a), proxima);
  else arquivos.delete(a.url);
}

// agrupa mudanças por 1,5 s para mandar um único aviso por rodada de boletins
let pendentes = new Set(), timerAviso = null;
function avisar(url) {
  pendentes.add(cargoDaUrl(url));
  if (timerAviso) return;
  timerAviso = setTimeout(() => {
    const cargos = [...pendentes];
    const msg = JSON.stringify({ cargos, em: new Date().toISOString() });
    pendentes = new Set(); timerAviso = null;
    for (const res of assinantes) res.write(`data: ${msg}\n\n`);
    if (cargos.includes(1)) aoMudarPresidente();
  }, 1500);
}

// metadados de atualização de um conjunto de arquivos (para exibir na tela)
function infoAtualizacao(urls) {
  const lista = urls.map(u => arquivos.get(u)).filter(a => a?.v?.ok);
  if (!lista.length) return null;
  const chave = g => { const [d, h] = g.split(' '); const [dd, mm, aa] = (d || '').split('/'); return `${aa}${mm}${dd}${h}`; };
  const maisRecente = lista.reduce((m, a) => (chave(a.v.geradoTSE) > chave(m.v.geradoTSE) ? a : m));
  return {
    boletimTSE: maisRecente.v.geradoTSE,
    verificadoEm: new Date(Math.max(...lista.map(a => a.verificadoEm))).toISOString(),
    proximaVerificacao: new Date(Math.min(...lista.map(a => a.proximaEm || Date.now() + 8_000))).toISOString(),
    arquivos: lista.length,
  };
}

// ---------- situação matemática (1º turno) ----------
// Fontes, em ordem: situação oficial do candidato (st), indicador "md" do TSE e, por último,
// o cálculo do pior cenário feito pelo painel: todos os eleitores das seções ainda não
// totalizadas votariam contra o candidato.
function definirSituacao(r, cargo) {
  const cs = r.candidatos;
  if (!cs.length || !r.secoesTotalizadas) return r;
  // Presidente se decide no total nacional: estado nenhum "elege" presidente sozinho
  if (cargo === 1 && r.uf !== 'br') return r;
  // pior cenário: todos os eleitores das seções ainda não totalizadas votam contra o candidato
  const restantes = Math.max(0, r.eleitores - r.eleitoresApurados);
  const marcar = (c, origem) => { if (!c.eleito) { c.eleitoMat = true; c.origemEleito = origem; } };
  // quantos adversários ainda podem alcançar c (cada eleitor dá no máximo 1 voto a cada candidato)
  const ameacas = c => cs.filter(o => o !== c && o.votos + restantes >= c.votos).length;
  if (cargo === 1 || cargo === 3) {
    const lider = cs[0];
    if (r.definicaoTSE === 'e') marcar(lider, 'tse');
    // maioria absoluta: votos anulados sub judice podem voltar a ser válidos e aumentar o total
    else if (lider.votos * 2 > r.validos + restantes + r.votosEmDisputa) marcar(lider, 'calculo');
    if (r.definicaoTSE === 's') for (const c of cs) if (!c.segundoTurno && c.votos > 0 && ameacas(c) < 2) c.segundoTurnoMat = true;
  } else if (cargo === 5) {
    const vagas = r.vagas || 1;
    for (const c of cs) if (c.votos > 0 && ameacas(c) < vagas) marcar(c, r.definicaoTSE === 'e' ? 'tse' : 'calculo');
  }
  return r;
}

// Normaliza o JSON de resultados do TSE (formato 2026: dados/<uf>/<uf>-cXXXX-eXXXXXX-u.json)
// Estrutura: carg[].agr[] (agremiação) -> par[] (partido) -> cand[]; totais em s{}, e{}, v{}
function normalizar(j, uf) {
  const s = j.s || {}, e = j.e || {}, v = j.v || {};
  const candidatos = [];
  const agremiacoes = [];
  let vagas = 0, quociente = 0;
  for (const cargo of j.carg || []) {
    vagas = num(cargo.nv);
    quociente = num(cargo.qe);
    for (const agr of cargo.agr || []) {
      const sigla = agr.tp === 'i' ? (agr.par?.[0]?.sg || agr.com) : agr.com;
      agremiacoes.push({
        sigla, nome: agr.nm, tipo: agr.tp, vagas: num(agr.vag),
        votos: (agr.par || []).reduce((t, p) => t + num(p.tvtn) + num(p.tvtl), 0),
        votosLegenda: (agr.par || []).reduce((t, p) => t + num(p.tvtl), 0),
      });
      for (const par of agr.par || []) {
        for (const c of par.cand || []) {
          candidatos.push({
            agremiacao: sigla,
            partidoSigla: par.sg,
            numero: c.n,
            nome: c.nmu || c.nm,
            nomeCompleto: c.nm,
            partido: agr.tp === 'c' ? `${par.sg} · ${agr.nm}` : par.sg || agr.com,
            sqcand: c.sqcand,
            votos: num(c.vap),
            pct: num(c.pvapn ?? c.pvap),
            // st traz a situação oficial: "Eleito", "Eleito por QP", "Eleito por média", "2º turno", "Suplente"...
            // (o campo "e" = "s" também vale para quem vai ao 2º turno, por isso não é usado como "eleito")
            eleito: /^eleit/i.test(c.st || ''),
            segundoTurno: /2º turno/i.test(c.st || ''),
            vices: (c.vs || []).map(v => ({ nome: v.nmu, nomeCompleto: v.nm, partido: v.sgp, tipo: v.tp })),
            situacao: c.st || '',
            destinacao: c.dvt || '',
          });
        }
      }
    }
  }
  const out = {
    uf,
    dataTotalizacao: j.dg || null,
    horaTotalizacao: j.hg || null,
    secoes: num(s.ts),
    secoesTotalizadas: num(s.st),
    pctSecoes: num(s.pstn ?? s.pst),
    eleitores: num(e.te),
    eleitoresApurados: num(e.est),
    comparecimento: num(e.c),
    abstencao: num(e.a),
    validos: num(v.vv),
    brancos: num(v.vb),
    nulos: num(v.tvn),
    // md do TSE: "e" = matematicamente eleito, "s" = 2º turno matematicamente definido, "n" = indefinido
    definicaoTSE: j.md || 'n',
    votosEmDisputa: num(v.van) + num(v.vansj),
    vagas, quociente,
    agremiacoes: agremiacoes.sort((a, b) => b.vagas - a.vagas || b.votos - a.votos),
    candidatos: candidatos.sort((a, b) => b.votos - a.votos),
  };
  return definirSituacao(out, Number(j.carg?.[0]?.cd));
}

// Soma vários resultados normalizados (para regiões)
function agregar(lista, rotulo) {
  const validos = lista.filter(Boolean);
  const out = {
    uf: rotulo, secoes: 0, secoesTotalizadas: 0, eleitores: 0, eleitoresApurados: 0, comparecimento: 0,
    abstencao: 0, validos: 0, brancos: 0, nulos: 0, candidatos: [],
    ufsComDados: validos.length,
  };
  const cands = new Map();
  for (const r of validos) {
    for (const k of ['secoes', 'secoesTotalizadas', 'eleitores', 'eleitoresApurados', 'comparecimento', 'abstencao', 'validos', 'brancos', 'nulos']) out[k] += r[k];
    for (const c of r.candidatos) {
      const acc = cands.get(c.numero) || { ...c, votos: 0 };
      acc.votos += c.votos;
      cands.set(c.numero, acc);
    }
  }
  out.pctSecoes = out.secoes ? (out.secoesTotalizadas / out.secoes) * 100 : 0;
  out.candidatos = [...cands.values()]
    .map(c => ({ ...c, pct: out.validos ? (c.votos / out.validos) * 100 : 0, eleito: false, eleitoMat: false, origemEleito: undefined, segundoTurno: false, segundoTurnoMat: false }))
    .sort((a, b) => b.votos - a.votos);
  return out;
}

// ---------- modo demonstração (dados fictícios, claramente rotulados) ----------
const DEMO_START = Date.now();
const DEMO_ELEITORES = { sp: 34.6, mg: 16.3, rj: 12.8, ba: 11.3, rs: 8.6, pr: 8.5, pe: 7.1, ce: 6.8, pa: 6.1, ma: 5.0, sc: 5.6, go: 4.9, pb: 3.1, am: 2.7, es: 2.9, pi: 2.6, rn: 2.6, al: 2.3, mt: 2.5, ms: 2.0, df: 2.2, se: 1.7, ro: 1.2, to: 1.1, ac: 0.6, ap: 0.6, rr: 0.4 };
const DEMO_CANDS = [
  { numero: '11', nome: 'CANDIDATO A', partido: 'Partido Fictício A' },
  { numero: '22', nome: 'CANDIDATO B', partido: 'Partido Fictício B' },
  { numero: '33', nome: 'CANDIDATO C', partido: 'Partido Fictício C' },
  { numero: '44', nome: 'CANDIDATO D', partido: 'Partido Fictício D' },
  { numero: '55', nome: 'CANDIDATO E', partido: 'Partido Fictício E' },
];
function seed(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507), h ^= h >>> 13, (h >>> 0) / 4294967296)); }
function demoUF(uf, cargo) {
  const rnd = seed(uf + cargo);
  const reg = Object.keys(REGIOES).find(k => REGIOES[k].ufs.includes(uf));
  const vies = { norte: [1.1, 0.9, 1, 1, 1], nordeste: [1.5, 0.6, 1, 0.9, 1], 'centro-oeste': [0.7, 1.4, 1, 1, 1], sudeste: [0.95, 1.1, 1.1, 1, 1], sul: [0.7, 1.5, 1, 1.1, 1] }[reg];
  const base = [42, 38, 9, 6, 5].map((b, i) => b * vies[i] * (0.85 + rnd() * 0.3));
  const elapsed = (Date.now() - DEMO_START) / 1000;
  const prog = Math.min(1, Math.max(0, (elapsed - rnd() * 40) / (180 + rnd() * 240)));
  const eleitores = Math.round(DEMO_ELEITORES[uf] * 1e6);
  const secoes = Math.round(eleitores / 330);
  const st = Math.round(secoes * prog);
  const comp = Math.round(eleitores * 0.79 * prog);
  const vb = Math.round(comp * 0.016), vn = Math.round(comp * 0.028);
  const vv = comp - vb - vn;
  const soma = base.reduce((a, b) => a + b, 0);
  const cands = DEMO_CANDS.map((c, i) => {
    const drift = 1 + (rnd() - 0.5) * 0.08 * (1 - prog);
    const votos = Math.round(vv * (base[i] / soma) * drift);
    return { ...c, sqcand: '', votos, pct: 0, eleito: false, situacao: '', destinacao: 'Válido' };
  });
  const totV = cands.reduce((a, c) => a + c.votos, 0) || 1;
  cands.forEach(c => (c.pct = (c.votos / totV) * 100));
  const now = new Date();
  return {
    uf, dataTotalizacao: now.toLocaleDateString('pt-BR'), horaTotalizacao: now.toLocaleTimeString('pt-BR'),
    secoes, secoesTotalizadas: st, pctSecoes: (st / secoes) * 100, eleitores, eleitoresApurados: Math.round(eleitores * prog),
    comparecimento: comp, abstencao: Math.round(eleitores * prog) - comp, validos: totV, brancos: vb, nulos: vn,
    candidatos: cands.sort((a, b) => b.votos - a.votos),
  };
}

// ---------- montagem das respostas ----------
async function painel(cargo, demo) {
  let porUF = {};
  let brasil = null, exterior = null, status = {};
  if (demo) {
    for (const uf of UFS) porUF[uf] = demoUF(uf, cargo);
  } else {
    const alvos = cargo === 1 ? [...UFS, 'br', 'zz'] : UFS;
    const res = await Promise.all(alvos.map(uf => fetchTSE(arquivoResultado(uf, cargo))));
    alvos.forEach((uf, i) => {
      status[uf] = res[i].ok ? 200 : res[i].status;
      if (!res[i].ok) return;
      const n = normalizar(res[i].data, uf);
      if (uf === 'br') brasil = n;
      else if (uf === 'zz') exterior = n;
      else porUF[uf] = n;
    });
  }
  const regioes = {};
  for (const [k, r] of Object.entries(REGIOES)) {
    regioes[k] = { ...agregar(r.ufs.map(u => porUF[u]), k), nome: r.nome, ufs: r.ufs };
  }
  // Brasil = arquivo nacional do TSE (o mesmo número do site oficial). Só usa a soma
  // das UFs + exterior se o arquivo nacional faltar ou estiver > 5 min atrás dos estaduais.
  if (cargo === 1 && Object.keys(porUF).length) {
    const minutos = r => { if (!r?.horaTotalizacao) return 0; const [d, m, a] = r.dataTotalizacao.split('/'); return Date.parse(`${a}-${m}-${d}T${r.horaTotalizacao}`) / 60000; };
    const ufMaisNova = Math.max(...Object.values(porUF).map(minutos));
    if (!brasil || ufMaisNova - minutos(brasil) > 5) {
      const soma = agregar([...Object.values(porUF), exterior], 'br');
      const oficial = new Map((brasil?.candidatos || []).map(c => [c.numero, c]));
      soma.candidatos = soma.candidatos.map(c => { const o = oficial.get(c.numero) || {}; return { ...c, eleito: !!o.eleito, eleitoMat: !!o.eleitoMat, origemEleito: o.origemEleito, segundoTurno: !!o.segundoTurno, segundoTurnoMat: !!o.segundoTurnoMat, situacao: o.situacao || '' }; });
      soma.origem = 'soma das UFs + exterior';
      soma.horaArquivoNacional = brasil?.horaTotalizacao || null;
      brasil = soma;
    } else brasil.origem = 'arquivo nacional';
  }
  return {
    fonte: demo ? 'demonstracao' : 'tse',
    cargo, cargoNome: CARGOS[cargo].nome,
    consultadoEm: new Date().toISOString(),
    disponivel: Object.keys(porUF).length > 0 || !!brasil,
    brasil, exterior, ufs: porUF, regioes, status,
    urlExemplo: arquivoResultado('br', 1),
    atualizacao: demo ? null : infoAtualizacao((cargo === 1 ? [...UFS, 'br', 'zz'] : UFS).map(uf => arquivoResultado(uf, cargo))),
  };
}

// ---------- cargos proporcionais (deputados) ----------
// Marca como "projetado" quem estaria dentro das vagas calculadas pelo TSE para sua
// agremiação (campo vag) e tem ao menos 10% do quociente eleitoral (art. 108 do Código Eleitoral).
function projetarEleitos(r) {
  const porAgr = new Map();
  for (const c of r.candidatos) {
    if (!porAgr.has(c.agremiacao)) porAgr.set(c.agremiacao, []);
    porAgr.get(c.agremiacao).push(c);
  }
  const minimo = r.quociente * 0.1;
  for (const a of r.agremiacoes) {
    const lista = (porAgr.get(a.sigla) || []).sort((x, y) => y.votos - x.votos);
    let n = 0;
    for (const c of lista) {
      // só concorre à vaga quem tem votos válidos: candidatura sub judice ou indeferida (votos anulados) não ocupa cadeira
      if (/^válido$/i.test(c.destinacao) && n < a.vagas && c.votos >= minimo) { c.projetado = true; n++; }
    }
  }
  return r;
}

async function proporcionalUF(cargo, uf) {
  const r = await fetchTSE(arquivoResultado(uf, cargo));
  if (!r.ok) return { disponivel: false, uf, cargo, status: r.status };
  const n = projetarEleitos(normalizar(r.data, uf));
  return { disponivel: true, cargo: cargoNaUF(cargo, uf), cargoNome: CARGOS[cargoNaUF(cargo, uf)].nome, consultadoEm: new Date().toISOString(), atualizacao: infoAtualizacao([arquivoResultado(uf, cargo)]), ...n };
}

// Soma as vagas projetadas de todas as UFs -> bancada projetada (Câmara ou soma das Assembleias)
async function bancada(cargo) {
  const res = await Promise.all(UFS.map(uf => fetchTSE(arquivoResultado(uf, cargo))));
  const total = new Map();
  const ufs = {};
  let secoes = 0, st = 0, vagas = 0;
  res.forEach((r, i) => {
    if (!r.ok) return;
    const n = normalizar(r.data, UFS[i]);
    secoes += n.secoes; st += n.secoesTotalizadas; vagas += n.vagas;
    ufs[UFS[i]] = { pctSecoes: n.pctSecoes, vagas: n.vagas, quociente: n.quociente, agremiacoes: n.agremiacoes.filter(a => a.vagas > 0) };
    for (const a of n.agremiacoes) {
      const t = total.get(a.sigla) || { sigla: a.sigla, nome: a.nome, vagas: 0, votos: 0 };
      t.vagas += a.vagas; t.votos += a.votos;
      total.set(a.sigla, t);
    }
  });
  return {
    disponivel: Object.keys(ufs).length > 0, cargo, consultadoEm: new Date().toISOString(),
    atualizacao: infoAtualizacao(UFS.map(uf => arquivoResultado(uf, cargo))),
    vagas, pctSecoes: secoes ? (st / secoes) * 100 : 0,
    agremiacoes: [...total.values()].sort((a, b) => b.vagas - a.vagas || b.votos - a.votos),
    ufs,
  };
}

// ---------- comparativo 2022 x 2026 (Presidente, 1º turno) ----------
const DATA_DIR = path.join(__dirname, 'data');
const lerJSON = (f, padrao) => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch { return padrao; } };
// 2022 por turno: 1 = 1º turno (02/10/2022), 2 = 2º turno (30/10/2022)
const P22 = { 1: lerJSON('2022-presidente-1t.json', null), 2: lerJSON('2022-presidente-2t.json', null) };
const H22 = { 1: lerJSON('2022-historico-br-1t.json', { pontos: [] }), 2: lerJSON('2022-historico-br-2t.json', { pontos: [] }) };
const ARQ_H26 = '2026-historico-br-1t.json';
const H26 = lerJSON(ARQ_H26, { fonte: 'Gravado localmente a partir dos arquivos do TSE durante a apuração', pontos: [] });
const NUM = { lula: '13', flavio: '22' };

function registrarHistorico2026(brasil) {
  if (!brasil?.secoesTotalizadas) return;
  const pct = c => brasil.candidatos.find(x => x.numero === c)?.pct ?? 0;
  const ult = H26.pontos[H26.pontos.length - 1];
  if (ult && ult.pctSecoes >= brasil.pctSecoes) return;
  H26.pontos.push({ hora: new Date().toISOString(), pctSecoes: brasil.pctSecoes, lula: pct(NUM.lula), flavio: pct(NUM.flavio) });
  try { fs.writeFileSync(path.join(DATA_DIR, ARQ_H26), JSON.stringify(H26)); } catch {}
}

function linha22(ufs, turno) {
  let v = 0, l = 0, j = 0;
  for (const uf of ufs) { const d = P22[turno]?.ufs?.[uf]; if (!d) continue; v += d.validos; l += d.votos['13'] || 0; j += d.votos['22'] || 0; }
  return { validos22: v, lula22: v ? (l / v) * 100 : null, jair22: v ? (j / v) * 100 : null, votosLula22: l, votosJair22: j };
}
function linha26(r) {
  if (!r) return { lula26: null, flavio26: null, pctSecoes26: 0 };
  const c = n => r.candidatos.find(x => x.numero === n);
  return { sqLula26: c(NUM.lula)?.sqcand, sqFlavio26: c(NUM.flavio)?.sqcand, lula26: c(NUM.lula)?.pct ?? null, flavio26: c(NUM.flavio)?.pct ?? null, votosLula26: c(NUM.lula)?.votos ?? 0, votosFlavio26: c(NUM.flavio)?.votos ?? 0, pctSecoes26: r.pctSecoes };
}

async function comparativo(turno = 1) {
  const p = await painel(1, false);
  registrarHistorico2026(p.brasil);
  const ufs = {}, regioes = {};
  for (const uf of UFS) ufs[uf] = { ...linha22([uf], turno), ...linha26(p.ufs[uf]) };
  for (const [k, r] of Object.entries(REGIOES)) regioes[k] = { nome: r.nome, ...linha22(r.ufs, turno), ...linha26(p.regioes[k]) };
  return {
    consultadoEm: new Date().toISOString(),
    atualizacao: p.atualizacao,
    turno2022: turno, turnosDisponiveis2022: [1, 2].filter(t => P22[t]),
    disponivel2022: !!P22[turno], disponivel2026: p.disponivel,
    brasil: { ...linha22([...UFS, 'zz'], turno), ...linha26(p.brasil) },
    exterior: { ...linha22(['zz'], turno), ...linha26(p.exterior) },
    regioes, ufs,
    historico2022: H22[turno].pontos, historico2026: H26.pontos,
    fontes: { y2022: P22[turno]?.fonte, historico2022: H22[turno].fonte, historico2026: H26.fonte },
  };
}

// grava o histórico de 2026 a cada boletim novo, mesmo sem navegador aberto
function aoMudarPresidente() { painel(1, false).then(p => registrarHistorico2026(p.brasil)).catch(() => {}); }
if (!SERVERLESS) {
  setInterval(aoMudarPresidente, 30_000);
  aoMudarPresidente();
}

// ---------- fotos dos candidatos (proxy do TSE com cache em disco) ----------
// /foto/<eleição>/<uf>/<sqcand>.jpeg -> ${TSE_BASE}/<eleição>/fotos/<uf>/<sqcand>.jpeg
// A foto é baixada do TSE uma única vez e guardada em data/fotos/.
const FOTOS_DIR = SERVERLESS ? path.join(require('os').tmpdir(), 'fotos') : path.join(__dirname, 'data', 'fotos');
const fotosAusentes = new Map(); // url -> quando o TSE respondeu "não existe" (evita repetir)
async function servirFoto(res, ele, uf, sq) {
  const arq = path.join(FOTOS_DIR, ele, uf, sq + '.jpeg');
  const enviar = buf => { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400, s-maxage=604800' }); res.end(buf); };
  if (fs.existsSync(arq)) return enviar(fs.readFileSync(arq));
  const url = `${TSE_BASE}/${ele}/fotos/${uf}/${sq}.jpeg`;
  if (Date.now() - (fotosAusentes.get(url) || 0) < 10 * 60_000) { res.writeHead(404); return res.end(); }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (painel-apuracao-local)' }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok || !/image/.test(r.headers.get('content-type') || '')) { fotosAusentes.set(url, Date.now()); res.writeHead(404); return res.end(); }
    const buf = Buffer.from(await r.arrayBuffer());
    try { fs.mkdirSync(path.dirname(arq), { recursive: true }); fs.writeFileSync(arq, buf); } catch {}
    enviar(buf);
  } catch { res.writeHead(502); res.end(); }
}

// ---------- Congresso 2027: Senado (81) e Câmara (513) ----------
// Senado = 54 eleitos em 2026 (2 por UF) + 27 eleitos em 2022 (mandato até 2031).
// Câmara = 513 eleitos em 2026. Antes do resultado final, usa a projeção de vagas do TSE.
// O espectro (esquerda/centro/direita) é editorial e vem de data/espectro.json.
function espectroDe(partido, mapa) {
  const p = String(partido || '').toUpperCase();
  for (const g of ['esquerda', 'centro', 'direita']) if ((mapa[g] || []).some(x => x.toUpperCase() === p)) return g;
  return 'outros';
}

// ---------- senadores com mandato até 2031 x eleição de 2026 ----------
// Quem foi eleito em 2022 e se elegeu agora para outro cargo deixa o Senado; assume o 1º suplente.
// O cruzamento é pelo NOME COMPLETO (sem acentos e espaços) na mesma UF — o nome de urna sozinho
// gera falsos positivos (ex.: há outro "CLEITINHO", deputado estadual em MG, que é outra pessoa).
const chaveNome = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

async function candidaturas2026(ufs) {
  const lista = [];
  const add = (uf, cargoNome, r, c, papel, pessoa) => lista.push({
    uf, cargoNome, papel, chave: chaveNome(pessoa.nomeCompleto), nome: pessoa.nome, partido: pessoa.partido,
    // situação da chapa/candidato
    eleito: !!c.eleito, eleitoMat: !!c.eleitoMat, segundoTurno: !!(c.segundoTurno || c.segundoTurnoMat),
    projetado: !!c.projetado, naoEleito: /não eleito/i.test(c.situacao || ''), pctApurado: r.pctSecoes,
  });
  const pres = await painel(1, false);
  if (pres.brasil) for (const c of pres.brasil.candidatos) {
    add('br', 'Presidente', pres.brasil, c, 'titular', { nome: c.nome, nomeCompleto: c.nomeCompleto, partido: c.partidoSigla });
    for (const v of c.vices) add('br', 'Vice-Presidente', pres.brasil, c, 'vice', v);
  }
  const gov = await painel(3, false);
  for (const [uf, r] of Object.entries(gov.ufs)) for (const c of r.candidatos) {
    add(uf, 'Governador', r, c, 'titular', { nome: c.nome, nomeCompleto: c.nomeCompleto, partido: c.partidoSigla });
    for (const v of c.vices) if (v.tipo === 'v') add(uf, 'Vice-Governador', r, c, 'vice', v);
  }
  for (const uf of new Set(ufs)) for (const cargo of [6, 7]) {
    const f = await fetchTSE(arquivoResultado(uf, cargo));
    if (!f.ok) continue;
    const r = projetarEleitos(normalizar(f.data, uf));
    const nomeCargo = cargo === 6 ? 'Deputado Federal' : CARGOS[cargoNaUF(cargo, uf)].nome;
    for (const c of r.candidatos) add(uf, nomeCargo, r, c, 'titular', { nome: c.nome, nomeCompleto: c.nomeCompleto, partido: c.partidoSigla });
  }
  return lista;
}

function cadeiraMandato2031(x, candidaturas, AJ) {
  const base = { uf: x.uf, sqcand: x.sqcand, origem: '2022', titular2022: x.nome };
  const ajuste = AJ[x.sqcand];
  if (ajuste) {
    return { ...base, nome: ajuste.nome || x.nome, partido: ajuste.partido || x.partido, status: ajuste.status || 'mandato',
      nota: ajuste.motivo || 'Ajuste manual (data/senado-ajustes.json)', ajustado: true };
  }
  const chave = chaveNome(x.nomeCompleto);
  const minhas = candidaturas.filter(c => c.chave === chave && (c.uf === x.uf || c.uf === 'br'));
  // suplente que assume: o 1º, salvo se ele próprio tiver sido eleito para outro cargo em 2026 (aí, o 2º)
  const candDe = p => candidaturas.filter(c => c.chave === chaveNome(p.nomeCompleto) && (c.uf === x.uf || c.uf === 'br'));
  const escolherSuplente = () => {
    for (const [i, p] of (x.suplentes || []).entries()) {
      const cs = candDe(p);
      if (cs.some(c => c.eleito || c.eleitoMat)) continue;
      return { ...p, ordem: i + 1, partido: cs[0]?.partido || p.partido, partidoFonte: cs.length ? 'candidatura de 2026' : 'registro de 2022' };
    }
    return null;
  };
  const sup = escolherSuplente();
  const venceu = minhas.find(c => c.eleito || c.eleitoMat);
  if (venceu && sup) {
    return { ...base, nome: sup.nome, partido: sup.partido, status: venceu.eleito ? 'suplente' : 'suplente-mat',
      nota: `Assume como ${sup.ordem}º suplente de ${x.nome}, eleito ${venceu.cargoNome.toLowerCase()} (${venceu.uf.toUpperCase()}) em 2026 ${venceu.eleito ? '(oficial TSE)' : '(matematicamente)'}. Partido do suplente: ${sup.partidoFonte}.` };
  }
  const segundo = minhas.find(c => c.segundoTurno);
  if (segundo) {
    return { ...base, nome: x.nome, partido: segundo.partido, status: 'incerto',
      nota: `Disputa o 2º turno para ${segundo.cargoNome.toLowerCase()}. Se vencer, assume o ${sup ? `${sup.ordem}º suplente ${sup.nome} (${sup.partido})` : 'suplente'}. Partido: candidatura de 2026.` };
  }
  const projetado = minhas.find(c => c.projetado);
  if (projetado) {
    return { ...base, nome: x.nome, partido: projetado.partido, status: 'incerto',
      nota: `Projetado como ${projetado.cargoNome.toLowerCase()}; se confirmado, assume o ${sup ? `${sup.ordem}º suplente ${sup.nome}` : 'suplente'}.` };
  }
  if (minhas.length) {
    const c = minhas[0];
    return { ...base, nome: x.nome, partido: c.partido, status: 'mandato',
      nota: `Candidato a ${c.cargoNome.toLowerCase()} em 2026, sem vitória: segue no Senado. Partido atualizado pela candidatura de 2026 (TSE)${c.partido !== x.partido ? `; em 2022 era ${x.partido}` : ''}.` };
  }
  return { ...base, nome: x.nome, partido: x.partido, status: 'mandato', nota: 'Partido da eleição de 2022 (TSE).' };
}

async function congresso() {
  const ESPECTRO = lerJSON('espectro.json', { esquerda: [], centro: [], direita: [] });
  const S31 = lerJSON('senado-mandato-2031.json', { senadores: [] });
  const AJ = lerJSON('senado-ajustes.json', { ajustes: {} }).ajustes || {};
  const cadeira = (o) => ({ ...o, espectro: espectroDe(o.partido, ESPECTRO) });

  // --- Senado ---
  const sen = await painel(5, false);
  const senado = [];
  let secS = 0, stS = 0;
  for (const uf of UFS) {
    const r = sen.ufs[uf];
    if (!r) continue;
    secS += r.secoes; stS += r.secoesTotalizadas;
    for (const c of r.candidatos.slice(0, r.vagas || 2)) {
      senado.push(cadeira({ nome: c.nome, partido: c.partidoSigla, uf, sqcand: c.sqcand, ele: '6259',
        status: c.eleito ? 'eleito' : c.eleitoMat ? 'garantido' : 'projetado', origem: '2026' }));
    }
  }
  const candidaturas = await candidaturas2026(S31.senadores.map(x => x.uf));
  for (const x of S31.senadores) senado.push(cadeira(cadeiraMandato2031(x, candidaturas, AJ)));

  // --- Câmara ---
  const res = await Promise.all(UFS.map(uf => fetchTSE(arquivoResultado(uf, 6))));
  const camara = [];
  const revisaoC = { conferidos: [], projetados: [], foraDaVaga: [], parciais: [] };
  let secC = 0, stC = 0, vagasC = 0;
  res.forEach((r, i) => {
    if (!r.ok) return;
    const uf = UFS[i];
    const n = projetarEleitos(normalizar(r.data, uf));
    secC += n.secoes; stC += n.secoesTotalizadas; vagasC += n.vagas;
    const oficiais = n.candidatos.filter(c => c.eleito);
    const projetados = n.candidatos.filter(c => c.projetado);
    // com resultado oficial, usa só os eleitos do TSE; antes disso, a projeção
    const escolhidos = oficiais.length ? oficiais : projetados;
    // revisão: nos estados já fechados, confere a projeção do painel contra a lista oficial
    if (oficiais.length) {
      const of = new Set(oficiais.map(c => c.sqcand));
      const iguais = projetados.filter(c => of.has(c.sqcand)).length;
      revisaoC.conferidos.push({ uf, vagas: n.vagas, oficiais: oficiais.length, iguais,
        divergencias: projetados.filter(c => !of.has(c.sqcand)).map(c => c.nome).concat(oficiais.filter(c => !c.projetado).map(c => c.nome + ' (oficial)')) });
    } else revisaoC.projetados.push({ uf, vagas: n.vagas, pctSecoes: n.pctSecoes });
    // candidaturas com votos anulados (sub judice/indeferidas) que teriam votos para disputar vaga
    for (const c of n.candidatos) {
      if (!/^válido$/i.test(c.destinacao) && c.votos >= n.quociente * 0.1) {
        revisaoC.foraDaVaga.push({ uf, nome: c.nome, partido: c.partidoSigla, votos: c.votos, destinacao: c.destinacao, situacao: c.situacao || '' });
      }
    }
    if (oficiais.length && oficiais.length < n.vagas) revisaoC.parciais.push({ uf, oficiais: oficiais.length, vagas: n.vagas });
    for (const c of escolhidos) {
      camara.push(cadeira({ nome: c.nome, partido: c.partidoSigla, uf, sqcand: c.sqcand, ele: '6259',
        status: c.eleito ? 'eleito' : 'projetado', origem: '2026' }));
    }
    // vagas da UF ainda sem titular (agremiação sem candidato com 10% do quociente etc.)
    for (let k = escolhidos.length; k < n.vagas; k++) camara.push({ nome: 'Vaga ainda indefinida', partido: '', uf, status: 'indefinido', espectro: 'indefinido' });
  });

  return {
    consultadoEm: new Date().toISOString(),
    atualizacao: infoAtualizacao(UFS.map(uf => arquivoResultado(uf, 6))),
    espectro: ESPECTRO,
    senado: { total: 81, maioria: 41, pctSecoes: secS ? (stS / secS) * 100 : 0, cadeiras: senado, fonte2031: S31.fonte },
    camara: { total: vagasC || 513, maioria: Math.floor((vagasC || 513) / 2) + 1, pctSecoes: secC ? (stC / secC) * 100 : 0, cadeiras: camara, revisao: revisaoC },
  };
}

// ---------- dados externos: mercado financeiro e mercados de previsão ----------
// Polymarket e Kalshi são bloqueados pelo DNS da rede local do usuário (bloqueio de apostas
// no Brasil). Por autorização expressa do usuário, SÓ esses domínios são resolvidos pelo DNS
// público (Cloudflare 1.1.1.1 / Google 8.8.8.8). Todo o resto usa o DNS do sistema.
// Na Vercel (fora do Brasil) a resolução normal funciona, então o desvio não é usado lá.
const DNS_PUBLICO = /(^|\.)(polymarket\.com|kalshi\.com)$/i;
const resolvedorPublico = new dns.Resolver();
resolvedorPublico.setServers(['1.1.1.1', '8.8.8.8']);
const lookupPublico = (host, opts, cb) => resolvedorPublico.resolve4(host, (e, ips) => {
  if (e) return cb(e);
  if (opts && opts.all) return cb(null, ips.map(address => ({ address, family: 4 })));
  cb(null, ips[0], 4);
});
const cacheExterno = new Map();
function obterJSON(url, ttlMs) {
  const hit = cacheExterno.get(url);
  if (hit && Date.now() - hit.t < ttlMs) return hit.p;
  const host = new URL(url).hostname;
  const p = new Promise((ok, falha) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (painel-apuracao-local)', Accept: 'application/json' },
      timeout: 12_000,
      ...(DNS_PUBLICO.test(host) && !SERVERLESS ? { lookup: lookupPublico } : {}),
    }, res => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => (d += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return falha(new Error(`HTTP ${res.statusCode} em ${host}`));
        try { ok(JSON.parse(d)); } catch (e) { falha(new Error(`resposta inválida de ${host}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`tempo esgotado em ${host}`)));
    req.on('error', falha);
  });
  // falha não fica em cache; um dado bom anterior continua servindo
  p.catch(() => { if (cacheExterno.get(url)?.p === p) { if (hit) cacheExterno.set(url, hit); else cacheExterno.delete(url); } });
  cacheExterno.set(url, { t: Date.now(), p });
  return p;
}

// --- Ibovespa e dólar (Yahoo Finance; B3 com atraso de até 15 min) ---
const ATIVOS = {
  ibov: { simbolo: '^BVSP', nome: 'Ibovespa', unidade: 'pontos', casas: 0 },
  dolar: { simbolo: 'BRL=X', nome: 'Dólar comercial (USD/BRL)', unidade: 'R$', casas: 4 },
};
const INTERVALOS = { '1d': '5m', '5d': '15m', '1mo': '60m' };
const DIA_ELEICAO = Date.parse('2026-10-04T00:00:00-03:00');
const yahoo = (simbolo, range, intervalo) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=${range}&interval=${intervalo}`;

async function ativo(chave, range) {
  const a = ATIVOS[chave];
  const [j, diario] = await Promise.all([
    obterJSON(yahoo(a.simbolo, range, INTERVALOS[range]), 30_000),
    obterJSON(yahoo(a.simbolo, '1mo', '1d'), 10 * 60_000),
  ]);
  const r = j.chart?.result?.[0];
  if (!r) throw new Error('sem dados para ' + a.nome);
  const m = r.meta, ts = r.timestamp || [], fech = r.indicators?.quote?.[0]?.close || [];
  const serie = ts.map((t, i) => [t * 1000, fech[i]]).filter(p => Number.isFinite(p[1]));
  // último fechamento diário antes do 1º turno (04/10/2026)
  const d = diario.chart?.result?.[0];
  const dts = d?.timestamp || [], dfech = d?.indicators?.quote?.[0]?.close || [];
  let preEleicao = null;
  // a data do candle diário é a do pregão no fuso da própria bolsa (FX do Yahoo usa meia-noite de Londres)
  const off = d?.meta?.gmtoffset || 0;
  const dataPregao = t => new Date((t + off) * 1000).toISOString().slice(0, 10).split('-').reverse().join('/');
  dts.forEach((t, i) => { if (t * 1000 < DIA_ELEICAO && Number.isFinite(dfech[i])) preEleicao = { data: t * 1000, dataTexto: dataPregao(t), valor: dfech[i] }; });
  const preco = m.regularMarketPrice;
  const anterior = range === '1d' ? (m.chartPreviousClose ?? m.previousClose) : (m.chartPreviousClose ?? serie[0]?.[1]);
  return {
    chave, nome: a.nome, unidade: a.unidade, casas: a.casas,
    preco, anterior,
    variacao: anterior ? ((preco - anterior) / anterior) * 100 : null,
    hora: (m.regularMarketTime || 0) * 1000,
    preEleicao,
    variacaoEleicao: preEleicao ? ((preco - preEleicao.valor) / preEleicao.valor) * 100 : null,
    serie,
  };
}
async function mercado(range) {
  if (!INTERVALOS[range]) range = '1d';
  const res = await Promise.allSettled(Object.keys(ATIVOS).map(k => ativo(k, range)));
  return {
    range, consultadoEm: new Date().toISOString(),
    fonte: 'Yahoo Finance (Ibovespa com atraso de até 15 min; dólar comercial em tempo real)',
    ativos: res.map((r, i) => (r.status === 'fulfilled' ? r.value : { chave: Object.keys(ATIVOS)[i], nome: Object.values(ATIVOS)[i].nome, erro: r.reason.message })),
  };
}

// --- Mercados de previsão: Polymarket e Kalshi (presidente 2026; o 2º turno é Flávio × Lula) ---
const PERIODOS = { '1d': { pm: '1d', fid: 10, kal: 1, seg: 86400 }, '1w': { pm: '1w', fid: 60, kal: 60, seg: 7 * 86400 }, '1m': { pm: '1m', fid: 360, kal: 1440, seg: 30 * 86400 } };
// ordem alfabética fixa, como no restante do painel
const DUELO = [
  { chave: 'flavio', nome: 'Flávio Bolsonaro', numero: '22', pm: /fl[aá]vio bolsonaro/i, kal: 'KXBRPRES-26-FBOL' },
  { chave: 'lula', nome: 'Lula', numero: '13', pm: /lula/i, kal: 'KXBRPRES-26-LULA' },
];
const num0 = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

async function polymarket(per) {
  const busca = await obterJSON('https://gamma-api.polymarket.com/public-search?q=brazil%20presidential%20election&limit_per_type=20', 30_000);
  const ev = (busca.events || []).find(e => e.slug === 'brazil-presidential-election');
  if (!ev) throw new Error('evento "Brazil Presidential Election" não encontrado na Polymarket');
  const abertos = (ev.markets || []).filter(m => !m.closed);
  const preco = m => { try { return num0(JSON.parse(m.outcomePrices)[0]); } catch { return null; } };
  const candidatos = await Promise.all(DUELO.map(async d => {
    const m = abertos.find(x => d.pm.test(x.groupItemTitle || x.question || ''));
    if (!m) return { ...d, prob: null, historico: [] };
    let historico = [];
    try {
      const token = JSON.parse(m.clobTokenIds)[0];
      const h = await obterJSON(`https://clob.polymarket.com/prices-history?market=${token}&interval=${PERIODOS[per].pm}&fidelity=${PERIODOS[per].fid}`, 60_000);
      historico = (h.history || []).map(p => [p.t * 1000, p.p]);
    } catch {}
    return { chave: d.chave, nome: d.nome, numero: d.numero, prob: preco(m), var24h: num0(m.oneDayPriceChange), volume: num0(m.volumeNum), historico };
  }));
  const outros = abertos.filter(m => !DUELO.some(d => d.pm.test(m.groupItemTitle || '')))
    .map(m => ({ nome: m.groupItemTitle, prob: preco(m) })).filter(o => o.prob > 0).sort((a, b) => b.prob - a.prob);
  return { plataforma: 'Polymarket', titulo: ev.title, volume: num0(ev.volume), moeda: 'US$', candidatos, outros, encerramento: ev.endDate };
}

async function kalshi(per) {
  const j = await obterJSON('https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=KXBRPRES&with_nested_markets=true', 30_000);
  const ev = (j.events || []).find(e => e.event_ticker === 'KXBRPRES-26');
  if (!ev) throw new Error('evento KXBRPRES-26 não encontrado na Kalshi');
  const fim = Math.floor(Date.now() / 1000), ini = fim - PERIODOS[per].seg;
  const candidatos = await Promise.all(DUELO.map(async d => {
    const m = (ev.markets || []).find(x => x.ticker === d.kal);
    if (!m) return { chave: d.chave, nome: d.nome, numero: d.numero, prob: null, historico: [] };
    let historico = [];
    try {
      const h = await obterJSON(`https://api.elections.kalshi.com/trade-api/v2/series/KXBRPRES/markets/${d.kal}/candlesticks?start_ts=${ini}&end_ts=${fim}&period_interval=${PERIODOS[per].kal}`, 60_000);
      historico = (h.candlesticks || []).map(c => [c.end_period_ts * 1000, num0(c.price?.close_dollars) ?? num0(c.price?.previous_dollars)]).filter(p => p[1] != null);
    } catch {}
    const ultimo = num0(m.last_price_dollars), anterior = num0(m.previous_price_dollars);
    return { chave: d.chave, nome: d.nome, numero: d.numero, prob: ultimo, var24h: ultimo != null && anterior != null ? ultimo - anterior : null,
      compra: num0(m.yes_ask_dollars), venda: num0(m.yes_bid_dollars), volume: num0(m.volume_fp), historico };
  }));
  const volume = (ev.markets || []).reduce((t, m) => t + (num0(m.volume_fp) || 0), 0);
  return { plataforma: 'Kalshi', titulo: ev.title, volume, moeda: 'US$', candidatos, outros: [], encerramento: ev.markets?.[0]?.expected_expiration_time };
}

async function previsoes(per) {
  if (!PERIODOS[per]) per = '1w';
  const [pm, ks] = await Promise.allSettled([polymarket(per), kalshi(per)]);
  return {
    periodo: per, consultadoEm: new Date().toISOString(),
    plataformas: [pm, ks].map((r, i) => (r.status === 'fulfilled' ? r.value : { plataforma: i ? 'Kalshi' : 'Polymarket', erro: r.reason.message })),
  };
}

// ---------- servidor HTTP ----------
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const PUBLIC = path.join(__dirname, 'public');

async function handler(req, res) {
  try {
  const u = new URL(req.url, 'http://localhost');
  // Vercel: as rotas chegam reescritas para /api/index?__p=<caminho original>
  const caminhoOriginal = u.searchParams.get('__p');
  if (caminhoOriginal !== null) { u.searchParams.delete('__p'); if (u.pathname.startsWith('/api/index')) u.pathname = '/' + caminhoOriginal; }
    if (u.pathname === '/api/painel') {
      const cargo = Number(u.searchParams.get('cargo') || 1);
      if (!CARGOS[cargo]) throw Object.assign(new Error('cargo inválido'), { code: 400 });
      const data = await painel(cargo, u.searchParams.get('demo') === '1');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(data));
    }
    if (u.pathname === '/api/proporcional' || u.pathname === '/api/bancada' || u.pathname === '/api/comparativo' || u.pathname === '/api/congresso') {
      let data;
      if (u.pathname === '/api/congresso') data = await congresso();
      else if (u.pathname === '/api/comparativo') data = await comparativo(u.searchParams.get('turno2022') === '2' ? 2 : 1);
      else {
        const cargo = Number(u.searchParams.get('cargo') || 6);
        if (![6, 7].includes(cargo)) throw Object.assign(new Error('cargo inválido'), { code: 400 });
        if (u.pathname === '/api/bancada') data = await bancada(cargo);
        else {
          const uf = String(u.searchParams.get('uf') || 'sp').toLowerCase();
          if (!UFS.includes(uf)) throw Object.assign(new Error('UF inválida'), { code: 400 });
          data = await proporcionalUF(cargo, uf);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(data));
    }
    const mFoto = u.pathname.match(/^\/foto\/(\d{3,6})\/([a-z]{2})\/(\d{6,15})\.jpe?g$/);
    if (mFoto) return servirFoto(res, mFoto[1], mFoto[2], mFoto[3]);
    if (u.pathname === '/api/mercado' || u.pathname === '/api/previsoes') {
      const data = u.pathname === '/api/mercado'
        ? await mercado(String(u.searchParams.get('range') || '1d'))
        : await previsoes(String(u.searchParams.get('periodo') || '1w'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(data));
    }
    if (u.pathname === '/api/status') {
      const agora = Date.now();
      const lista = [...arquivos.values()].map(a => ({
        arquivo: a.url.replace(TSE_BASE, ''), boletimTSE: a.v?.geradoTSE || null, status: a.v?.ok ? 'ok' : a.v?.status,
        verificadoHa_s: a.verificadoEm ? Math.round((agora - a.verificadoEm) / 1000) : null,
        mudouHa_s: a.mudouEm ? Math.round((agora - a.mudouEm) / 1000) : null,
        consultas: a.consultas || 0, respostas304: a.r304 || 0, erros: a.erros || 0, ultimoErro: a.ultimoErro || null,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ arquivos: lista.length, navegadoresConectados: assinantes.size, lista }, null, 1));
    }
    if (u.pathname === '/api/eventos') {
      if (SERVERLESS) { res.writeHead(204); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      assinantes.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.on('close', () => { clearInterval(ping); assinantes.delete(res); });
      return;
    }
    if (u.pathname === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ regioes: REGIOES, cargos: CARGOS, eleicoes: ELEICOES, tseBase: TSE_BASE, tempoReal: SERVERLESS ? 'consulta' : 'eventos' }));
    }
    const file = path.normalize(path.join(PUBLIC, u.pathname === '/' ? 'index.html' : u.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(typeof e.code === 'number' ? e.code : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: e.message }));
  }
}

module.exports = handler;
if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`\n  Painel de Apuração 2026 rodando em  http://localhost:${PORT}\n  Fonte: ${TSE_BASE}\n`);
  });
}
