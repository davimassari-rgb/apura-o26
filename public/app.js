// Painel de Apuração 2026 – front-end
// Atualização principal: aviso do servidor (SSE) assim que o TSE publica um boletim novo.
// O intervalo abaixo é só uma rede de segurança caso a conexão de eventos caia.
const INTERVALO_MS = 60_000;
const PALETA = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#64748b', '#854d0e', '#0f766e'];
const NOMES_UF = {
  ac: 'Acre', al: 'Alagoas', ap: 'Amapá', am: 'Amazonas', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal',
  es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão', mt: 'Mato Grosso', ms: 'Mato Grosso do Sul', mg: 'Minas Gerais',
  pa: 'Pará', pb: 'Paraíba', pr: 'Paraná', pe: 'Pernambuco', pi: 'Piauí', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte',
  rs: 'Rio Grande do Sul', ro: 'Rondônia', rr: 'Roraima', sc: 'Santa Catarina', sp: 'São Paulo', se: 'Sergipe', to: 'Tocantins',
};
// Posição [linha, coluna] de cada UF no mapa em grade
const GRADE = {
  rr: [0, 1], ap: [0, 3],
  am: [1, 0], pa: [1, 2], ma: [1, 3], ce: [1, 4], rn: [1, 5],
  ac: [2, 0], ro: [2, 1], to: [2, 2], pi: [2, 3], pe: [2, 4], pb: [2, 5],
  mt: [3, 1], go: [3, 2], df: [3, 3], ba: [3, 4], al: [3, 5],
  ms: [4, 1], sp: [4, 2], mg: [4, 3], es: [4, 4], se: [4, 5],
  pr: [5, 2], rj: [5, 3],
  sc: [6, 2],
  rs: [7, 2],
};

// Abas adicionais registram aqui { carregar: async () => {}, render: () => {} }
const ABAS_EXTRA = {};

const estado = {
  fonte: 'tse', aba: 'brasil', regiao: 'todas', uf: 'sp', cargo: 1,
  config: null, dados: {}, cores: new Map(), timer: null, carregando: false,
};

const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString('pt-BR');
const pct = (n, d = 2) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iniciais = nome => String(nome).split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('');

// Selo "ELEITO" (oficial do TSE ou matematicamente garantido) e "2º TURNO"
const ICONE_SELO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.5l2.4 1.9 3.1-.3.9 3 2.8 1.5-1 2.9 1 2.9-2.8 1.5-.9 3-3.1-.3L12 22.5l-2.4-1.9-3.1.3-.9-3-2.8-1.5 1-2.9-1-2.9 2.8-1.5.9-3 3.1.3z"/><path d="M7.6 12.3l2.9 2.9 5.9-6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function seloSituacao(c) {
  if (/sub judice/i.test(c.destinacao || '')) return `<span class="selo selo-2t" title="Votos anulados sub judice: a candidatura aguarda decisão da Justiça Eleitoral">SUB JUDICE</span>`;
  if (c.eleito) return `<span class="selo selo-eleito" title="Eleito · resultado oficial do TSE">${ICONE_SELO}ELEITO</span>`;
  if (c.eleitoMat) {
    const t = c.origemEleito === 'tse'
      ? 'Matematicamente eleito · o TSE já indica o resultado como definido'
      : 'Matematicamente eleito · mesmo que todos os eleitores das seções ainda não apuradas votassem nos adversários, a vitória está garantida';
    return `<span class="selo selo-eleito" title="${t}">${ICONE_SELO}ELEITO</span>`;
  }
  if (c.segundoTurno || c.segundoTurnoMat) return `<span class="selo selo-2t" title="${c.segundoTurno ? 'No 2º turno · oficial do TSE' : '2º turno matematicamente garantido'}">2º TURNO</span>`;
  return '';
}
const eleitoDe = c => c.eleito || c.eleitoMat;

function corDe(chave) {
  if (!estado.cores.has(chave)) estado.cores.set(chave, PALETA[estado.cores.size % PALETA.length]);
  return estado.cores.get(chave);
}

// ---------- dados ----------
async function buscar(cargo) {
  const q = new URLSearchParams({ cargo });
  if (estado.fonte === 'demo') q.set('demo', '1');
  const r = await fetch('/api/painel?' + q);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function atualizar() {
  if (estado.carregando) return;
  estado.carregando = true;
  $('#btnAtualizar').disabled = true;
  try {
    const cargos = new Set([1]);
    if (estado.aba === 'estados') cargos.add(estado.cargo);
    const res = await Promise.all([...cargos].map(c => buscar(c).then(d => [c, d])));
    for (const [c, d] of res) estado.dados[c] = d;
    // cores estáveis: ordem do ranking nacional de presidente
    const p = estado.dados[1];
    if (p?.brasil) p.brasil.candidatos.forEach(c => corDe('1-' + c.numero));
    const extra = ABAS_EXTRA[estado.aba];
    if (extra) await extra.carregar();
    render();
  } catch (e) {
    mostrarAviso(`Falha ao consultar o servidor local: ${esc(e.message)}`);
  } finally {
    estado.carregando = false;
    $('#btnAtualizar').disabled = false;
  }
}

function agendar() {
  clearInterval(estado.timer);
  // na Vercel (sem conexões longas) o painel consulta a cada 10 s; localmente usa eventos (SSE)
  const porConsulta = estado.config?.tempoReal === 'consulta';
  estado.timer = setInterval(atualizar, porConsulta ? 10_000 : INTERVALO_MS);
  setInterval(mostrarRelogio, 1000);
  if (porConsulta) estado.aovivo = true;
  else conectarEventos();
}

// Cargos cujos dados cada aba exibe (para decidir se um aviso do servidor interessa)
function cargosDaAba() {
  return { governadores: [3], senadores: [5], depfed: [6], depest: [7], congresso: [5, 6], estados: [1, estado.cargo] }[estado.aba] || [1];
}

let fila = null;
function conectarEventos() {
  if (!window.EventSource) return;
  const es = new EventSource('/api/eventos');
  es.onopen = () => { estado.aovivo = true; mostrarRelogio(); };
  es.onerror = () => { estado.aovivo = false; mostrarRelogio(); };
  es.onmessage = ev => {
    if (estado.fonte !== 'tse') return;
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg.cargos.some(c => cargosDaAba().includes(c))) return;
    // no máximo uma recarga a cada 2 s; avisos que chegam no meio são agrupados
    if (fila) return;
    const espera = Math.max(0, 2000 - (Date.now() - (estado.ultimaRecarga || 0)));
    fila = setTimeout(async () => {
      fila = null;
      if (estado.carregando) { setTimeout(atualizar, 800); return; }
      estado.ultimaRecarga = Date.now();
      await atualizar();
    }, espera);
  };
}

// Metadados de atualização (boletim do TSE) dos dados que a aba atual está mostrando
function infoAtual() {
  const c = { 6: 'depfed', 7: 'depest' };
  switch (estado.aba) {
    case 'governadores': return estado.dados[3]?.atualizacao;
    case 'senadores': return estado.dados[5]?.atualizacao;
    case 'depfed': case 'depest': { const k = estado.aba === 'depfed' ? 6 : 7; return estado.dadosProp?.[k + '-' + estado.prop[k]]?.atualizacao; }
    case 'comparativo': return estado.comp?.atualizacao;
    case 'congresso': return estado.congresso?.atualizacao;
    case 'estados': return estado.dados[estado.cargo]?.atualizacao;
    default: return estado.dados[1]?.atualizacao;
  }
}

function mostrarRelogio() {
  const el = $('#atualizado');
  if (estado.fonte === 'demo') { el.textContent = 'Dados fictícios'; return; }
  const i = infoAtual();
  if (!i) { el.textContent = 'Aguardando TSE…'; return; }
  const seg = Math.max(0, Math.round((Date.now() - Date.parse(i.verificadoEm)) / 1000));
  const prox = Math.max(0, Math.round((Date.parse(i.proximaVerificacao) - Date.now()) / 1000));
  const hora = i.boletimTSE.split(' ')[1] || i.boletimTSE;
  el.innerHTML = `Boletim TSE <b>${esc(hora)}</b> · verificado há ${seg}s${prox ? ` · próxima em ${prox}s` : ''}${estado.aovivo ? '' : ' · <span title="Sem conexão de eventos; atualizando a cada 60 s">reconectando…</span>'}`;
}

// ---------- componentes ----------
function blocoProgresso(r) {
  if (!r) return '';
  return `<div class="progresso">
    <div class="rotulo"><span>Seções totalizadas <b>${pct(r.pctSecoes)}</b></span>
      <span>${fmt(r.secoesTotalizadas)} de ${fmt(r.secoes)}${r.horaTotalizacao ? ` · TSE ${esc(r.dataTotalizacao)} ${esc(r.horaTotalizacao)}` : ''}${r.origem === 'soma das UFs + exterior' ? ' · soma das UFs + exterior (arquivo nacional do TSE atrasado)' : ''}</span></div>
    <div class="barra"><span style="width:${Math.min(100, r.pctSecoes)}%"></span></div>
  </div>`;
}

// Foto oficial do candidato (TSE), servida pelo proxy local /foto/<eleição>/<uf>/<sqcand>.jpeg
function fotoUrl(cargo, uf, sqcand) {
  if (!sqcand || estado.fonte === 'demo' || !estado.config) return '';
  const ele = estado.config.cargos[cargo]?.eleicao;
  return ele ? `/foto/${ele}/${uf}/${sqcand}.jpeg` : '';
}
// Avatar: iniciais na cor do candidato, cobertas pela foto quando ela existe
function avatar(c, cargo, uf, cor, tamanho = 48, urlFixa) {
  const url = urlFixa || fotoUrl(cargo, uf, c.sqcand);
  return `<span class="foto ${eleitoDe(c) ? 'foto-eleito' : ''}" style="background:${cor};--t:${tamanho}px" title="${esc(c.nomeCompleto || c.nome)}">${esc(iniciais(c.nome))}${url ? `<img src="${url}" alt="Foto de ${esc(c.nome)}" decoding="async" onerror="this.remove()">` : ''}</span>`;
}

function listaCandidatos(r, cargo, uf, { compacto = false, limite = 99 } = {}) {
  if (!r || !r.candidatos.length) return '<div class="vazio">Sem votos apurados ainda.</div>';
  const html = r.candidatos.slice(0, limite).map(c => {
    const cor = corDe(cargo + '-' + c.numero);

    const tag = seloSituacao(c);
    return `<div class="cand ${eleitoDe(c) ? 'eleito' : ''}" style="--cor:${cor}">
      ${avatar(c, cargo, uf, cor, compacto ? 36 : 48)}
      <div style="min-width:0">
        <div class="nome">${esc(c.nome)} <small style="color:var(--muted)">${esc(c.numero)}</small> ${tag}</div>
        <div class="partido">${esc(c.partido)}</div>
        <div class="barra"><span style="width:${Math.min(100, c.pct)}%"></span></div>
      </div>
      <div class="pct"><b>${pct(c.pct)}</b><small>${fmt(c.votos)} votos</small></div>
    </div>`;
  }).join('');
  return compacto ? `<div class="lista-cand compacto">${html}</div>` : html;
}

function blocoNumeros(r) {
  if (!r) return '';
  const tot = r.comparecimento || 1;
  const apur = r.eleitoresApurados || 1; // eleitores das seções já totalizadas
  const itens = [
    ['Eleitores', fmt(r.eleitores)],
    ['Comparecimento', fmt(r.comparecimento), pct((r.comparecimento / apur) * 100)],
    ['Abstenção', fmt(r.abstencao), pct((r.abstencao / apur) * 100)],
    ['Votos válidos', fmt(r.validos), pct((r.validos / tot) * 100)],
    ['Brancos', fmt(r.brancos), pct((r.brancos / tot) * 100)],
    ['Nulos', fmt(r.nulos), pct((r.nulos / tot) * 100)],
  ];
  return itens.map(([k, v, p]) => `<div class="num"><span>${k}</span><b>${v}</b>${p ? `<small>${p}</small>` : ''}</div>`).join('');
}

function barraEmpilhada(r, cargo) {
  if (!r?.candidatos.length) return '<div class="empilhada"></div>';
  return `<div class="empilhada" title="Distribuição dos votos válidos">${r.candidatos
    .map(c => `<span style="width:${c.pct}%;background:${corDe(cargo + '-' + c.numero)}" title="${esc(c.nome)} ${pct(c.pct)}"></span>`).join('')}</div>`;
}

// ---------- abas ----------
function renderBrasil() {
  const d = estado.dados[1];
  const br = d?.brasil;
  $('#brProgresso').innerHTML = blocoProgresso(br);
  $('#brCandidatos').innerHTML = br ? listaCandidatos(br, 1, 'br') : '<div class="vazio">Aguardando divulgação do TSE.</div>';
  $('#brNumeros').innerHTML = blocoNumeros(br);

  // mapa
  const lideres = new Map();
  $('#mapa').innerHTML = Object.entries(GRADE).map(([uf, [l, c]]) => {
    const r = d?.ufs?.[uf];
    const lider = r?.candidatos?.[0];
    const temVoto = lider && lider.votos > 0;
    if (temVoto) lideres.set(lider.numero, lider.nome);
    const cor = temVoto ? corDe('1-' + lider.numero) : '';
    const titulo = temVoto ? `${NOMES_UF[uf]}: ${lider.nome} ${pct(lider.pct)} · ${pct(r.pctSecoes, 1)} apurado` : NOMES_UF[uf];
    return `<button class="tile ${temVoto ? '' : 'vazio-dado'}" data-uf="${uf}" title="${esc(titulo)}"
      style="grid-row:${l + 1};grid-column:${c + 1};${cor ? `background:${cor}` : ''}">
      ${uf.toUpperCase()}${r ? `<small>${pct(r.pctSecoes, 0)}</small>` : ''}</button>`;
  }).join('');
  $('#mapaLegenda').innerHTML = [...lideres].map(([n, nome]) => `<span><i style="background:${corDe('1-' + n)}"></i>${esc(nome)}</span>`).join('')
    || '<span>Cor = candidato à frente no estado</span>';
}

function cardRegiao(chave, r, d) {
  const ufs = r.ufs.map(uf => {
    const x = d.ufs[uf];
    const l = x?.candidatos?.[0];
    const s = x?.candidatos?.[1];
    return `<tr data-uf="${uf}">
      <td>${l ? `<span class="cor-dot" style="background:${corDe('1-' + l.numero)}"></span>` : ''}${NOMES_UF[uf]}</td>
      <td>${x ? pct(x.pctSecoes, 1) : '—'}</td>
      <td>${l ? `${esc(l.nome)} ${pct(l.pct, 1)}` : '—'}</td>
      <td>${s ? `${esc(s.nome)} ${pct(s.pct, 1)}` : '—'}</td>
    </tr>`;
  }).join('');
  return `<div class="card">
    <div class="regiao-head"><h3>${esc(r.nome)}</h3><span>${r.ufs.length} UFs · ${fmt(r.eleitores)} eleitores</span></div>
    ${blocoProgresso(r)}
    ${barraEmpilhada(r, 1)}
    ${listaCandidatos(r, 1, 'br', { compacto: true, limite: estado.regiao === 'todas' ? 4 : 99 })}
    ${estado.regiao === 'todas'
      ? `<p style="margin:14px 0 0"><button class="btn-link" data-ir-regiao="${chave}">Ver detalhes por estado →</button></p>`
      : `<h2 style="margin-top:24px">Por estado</h2><div class="tabela-wrap"><table>
          <thead><tr><th>Estado</th><th>Apurado</th><th>1º colocado</th><th>2º colocado</th></tr></thead>
          <tbody>${ufs}</tbody></table></div>`}
  </div>`;
}

function renderRegioes() {
  const d = estado.dados[1];
  document.querySelectorAll('#filtroRegiao button').forEach(b => b.classList.toggle('ativo', b.dataset.regiao === estado.regiao));
  if (!d || !d.disponivel) {
    $('#regioesConteudo').innerHTML = '<div class="card vazio">Aguardando divulgação do TSE.</div>';
    return;
  }
  if (estado.regiao === 'todas') {
    // comparativo: tabela região × candidato
    const top = (d.brasil?.candidatos || []).slice(0, 5);
    const regs = Object.entries(d.regioes);
    const tabela = `<div class="card"><h2>Comparativo regional · Presidente</h2><div class="tabela-wrap"><table>
      <thead><tr><th>Região</th><th>Apurado</th>${top.map(c => `<th><span class="cor-dot" style="background:${corDe('1-' + c.numero)}"></span>${esc(c.nome)}</th>`).join('')}<th>Abstenção</th></tr></thead>
      <tbody>${regs.map(([k, r]) => `<tr data-regiao="${k}"><td>${esc(r.nome)}</td><td>${pct(r.pctSecoes, 1)}</td>${top.map(c => {
        const x = r.candidatos.find(y => y.numero === c.numero);
        const lider = r.candidatos[0]?.numero === c.numero;
        return `<td>${lider ? '<b>' : ''}${x ? pct(x.pct) : '—'}${lider ? '</b>' : ''}</td>`;
      }).join('')}<td>${pct((r.abstencao / (r.eleitoresApurados || 1)) * 100, 1)}</td></tr>`).join('')}</tbody></table></div></div>`;
    $('#regioesConteudo').innerHTML = tabela + `<div class="regioes-grid" style="margin-top:20px">${regs.map(([k, r]) => cardRegiao(k, r, d)).join('')}</div>`;
  } else {
    const r = d.regioes[estado.regiao];
    $('#regioesConteudo').innerHTML = `<div class="grid-topo">${cardRegiao(estado.regiao, r, d)}
      <div class="card"><h2>Comparecimento · ${esc(r.nome)}</h2><div class="numeros">${blocoNumeros(r)}</div></div></div>`;
  }
}

function renderEstados() {
  const d = estado.dados[estado.cargo];
  const r = d?.ufs?.[estado.uf];
  $('#ufTitulo').textContent = `${d?.cargoNome || ''} · ${NOMES_UF[estado.uf]}`;
  $('#ufProgresso').innerHTML = blocoProgresso(r);
  $('#ufCandidatos').innerHTML = r ? listaCandidatos(r, estado.cargo, estado.cargo === 1 ? 'br' : estado.uf)
    : '<div class="vazio">Aguardando divulgação do TSE para este estado.</div>';
  $('#ufNumeros').innerHTML = blocoNumeros(r);
}

function mostrarAviso(html) {
  const el = $('#aviso');
  el.hidden = !html;
  el.innerHTML = html || '';
}

function render() {
  const d = estado.dados[1];
  const demo = estado.fonte === 'demo';
  $('#pontoAoVivo').classList.toggle('vivo', !!d?.disponivel);
  mostrarRelogio();
  $('#subtitulo').textContent = demo
    ? 'MODO DEMONSTRAÇÃO · dados fictícios, apenas para testar o painel'
    : '1º turno · 04/10/2026 · Fonte oficial: TSE (resultados.tse.jus.br)';

  if (demo) {
    mostrarAviso('<b>Modo demonstração:</b> os números e candidatos abaixo são <b>fictícios</b> e servem só para visualizar o painel. <button class="btn" data-fonte-ir="tse">Voltar ao oficial</button>');
  } else if (d && !d.disponivel) {
    mostrarAviso(`<b>Aguardando a primeira divulgação do TSE.</b> Os resultados começam a ser publicados após o encerramento da votação (17h de Brasília). O painel é avisado automaticamente assim que o TSE publicar.<br>
      <small>Arquivo monitorado: <code>${esc(d.urlExemplo)}</code></small>
      <button class="btn" data-fonte-ir="demo">Ver demonstração</button>`);
  } else mostrarAviso('');

  renderBrasil();
  renderRegioes();
  renderEstados();
  ABAS_EXTRA[estado.aba]?.render();
}

// ---------- eventos ----------
function trocarAba(aba) {
  estado.aba = aba;
  document.querySelectorAll('.abas button').forEach(b => b.classList.toggle('ativo', b.dataset.aba === aba));
  document.querySelectorAll('.aba').forEach(s => (s.hidden = s.id !== 'aba-' + aba));
  if (aba === 'estados' && !estado.dados[estado.cargo]) atualizar();
  else if (ABAS_EXTRA[aba]) { ABAS_EXTRA[aba].render(); atualizar(); }
}
function trocarFonte(f) {
  estado.fonte = f;
  estado.dados = {};
  document.querySelectorAll('[data-fonte]').forEach(b => b.classList.toggle('ativo', b.dataset.fonte === f));
  atualizar();
}
function irParaUF(uf, cargo) {
  estado.uf = uf;
  $('#selUF').value = uf;
  if (cargo) { estado.cargo = Number(cargo); $('#selCargo').value = String(cargo); }
  trocarAba('estados');
  render();
}

document.addEventListener('click', e => {
  const t = e.target.closest('button, tr');
  if (!t) return;
  if (t.dataset.aba) trocarAba(t.dataset.aba);
  else if (t.dataset.fonte) trocarFonte(t.dataset.fonte);
  else if (t.dataset.fonteIr) trocarFonte(t.dataset.fonteIr);
  else if (t.dataset.regiao) { estado.regiao = t.dataset.regiao; if (estado.aba !== 'regioes') trocarAba('regioes'); renderRegioes(); }
  else if (t.dataset.irRegiao) { estado.regiao = t.dataset.irRegiao; renderRegioes(); }
  else if (t.dataset.uf) irParaUF(t.dataset.uf, t.dataset.cargo);
  else if (t.id === 'btnAtualizar') atualizar();
});
$('#selUF').addEventListener('change', e => { estado.uf = e.target.value; renderEstados(); });
$('#selCargo').addEventListener('change', e => {
  estado.cargo = Number(e.target.value);
  if (estado.dados[estado.cargo]) renderEstados(); else atualizar();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });

// ---------- início ----------
(async function init() {
  $('#selUF').innerHTML = Object.entries(NOMES_UF).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
    .map(([uf, n]) => `<option value="${uf}">${n}</option>`).join('');
  $('#selUF').value = estado.uf;
  try { estado.config = await (await fetch('/api/config')).json(); } catch {}
  $('#rodapeUrl').textContent = estado.config ? `Base: ${estado.config.tseBase}` : '';
  await atualizar();
  agendar();
})();
