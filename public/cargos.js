// Abas por cargo: Governadores, Senadores, Deputados Federais e Deputados Estaduais
// Depende de app.js (estado, $, fmt, pct, esc, NOMES_UF, ABAS_EXTRA, blocoProgresso, mostrarAviso)

// ---------- cores por partido (a cor acompanha a agremiação em todas as abas) ----------
const CORES_PARTIDO = [
  [/\bPT\b|FE BRASIL/, '#c8102e'],
  [/\bPL\b/, '#1d4ed8'],
  [/UNIÃO|\bPP\b/, '#0e7490'],
  [/\bPSD\b/, '#ca8a04'],
  [/\bMDB\b/, '#15803d'],
  [/REPUBLICANOS/, '#7c3aed'],
  [/PSOL|REDE/, '#a21caf'],
  [/\bPSB\b/, '#ea580c'],
  [/\bPODE\b|PODEMOS/, '#4f46e5'],
  [/\bPDT\b/, '#db2777'],
  [/PSDB|CIDADANIA/, '#0369a1'],
  [/NOVO/, '#f97316'],
  [/AVANTE/, '#0d9488'],
  [/MISSÃO/, '#57534e'],
  [/SOLIDARIEDADE|\bPRD\b/, '#b45309'],
];
const corPartido = sigla => {
  const s = String(sigla || '').toUpperCase();
  for (const [re, cor] of CORES_PARTIDO) if (re.test(s)) return cor;
  return '#94a3b8';
};
const siglaDe = c => c.partidoSigla || String(c.partido || '').split(' · ')[0];

const ESCOPO_CARGO = { governadores: 3, senadores: 5, depfed: 6, depest: 7 };
const ROTULO_REGIAO = { todas: 'Todas', norte: 'Norte', nordeste: 'Nordeste', 'centro-oeste': 'Centro-Oeste', sudeste: 'Sudeste', sul: 'Sul' };
const UFS_REGIAO = {
  norte: ['ac', 'ap', 'am', 'pa', 'ro', 'rr', 'to'], nordeste: ['al', 'ba', 'ce', 'ma', 'pb', 'pe', 'pi', 'rn', 'se'],
  'centro-oeste': ['df', 'go', 'mt', 'ms'], sudeste: ['es', 'mg', 'rj', 'sp'], sul: ['pr', 'rs', 'sc'],
};
Object.assign(estado, { filtroGrade: 'todas', prop: { 6: 'brasil', 7: 'brasil' }, dadosProp: {}, busca: '', limiteCand: 60 });

function chipsRegiao(atual, acao) {
  return `<div class="seg seg-regioes">${Object.entries(ROTULO_REGIAO)
    .map(([k, n]) => `<button data-acao="${acao}" data-valor="${k}" class="${k === atual ? 'ativo' : ''}">${n}</button>`).join('')}</div>`;
}
const ufsFiltradas = f => (f === 'todas' ? Object.keys(NOMES_UF) : UFS_REGIAO[f]).slice().sort((a, b) => NOMES_UF[a].localeCompare(NOMES_UF[b], 'pt-BR'));

// ---------- Governadores e Senadores: grade com as 27 UFs ----------
function cardMajoritario(cargo, uf, r) {
  if (!r) return `<div class="card uf-card"><div class="regiao-head"><h3>${NOMES_UF[uf]}</h3><span>sem dados</span></div></div>`;
  const vagas = cargo === 5 ? (r.vagas || 1) : 1;
  const linhas = r.candidatos.slice(0, cargo === 5 ? 4 : 3).map((c, i) => {
    const cor = corPartido(siglaDe(c));
    const tag = seloSituacao(c)
      || (cargo === 5 && i < vagas && c.votos > 0 ? '<span class="tag tag-suave">na vaga</span>' : '');
    return `<div class="mini-cand com-foto">
      ${avatar(c, cargo, uf, cor, 40)}
      <div class="mini-corpo">
        <div class="mini-topo"><span class="mini-nome">${esc(c.nome)} ${tag}</span><b>${pct(c.pct, 1)}</b></div>
        <div class="mini-sub"><i class="cor-dot" style="background:${cor}"></i>${esc(siglaDe(c))} · ${fmt(c.votos)} votos</div>
        <div class="barra fina"><span style="width:${Math.min(100, c.pct)}%;background:${cor}"></span></div>
      </div>
    </div>`;
  }).join('');
  const nEleitos = r.candidatos.filter(eleitoDe).length;
  const definido = nEleitos >= vagas ? 'definido' : r.definicaoTSE === 's' || r.candidatos.some(c => c.segundoTurno) ? '2º turno' : '';
  return `<button class="card uf-card ${nEleitos ? 'card-eleito' : ''}" data-uf="${uf}" data-cargo="${cargo}" title="Ver todos os candidatos">
    <div class="regiao-head"><h3>${NOMES_UF[uf]}</h3><span>${definido ? `<b class="estado-def">${definido === 'definido' ? '✓ definido' : '2º turno'}</b> · ` : ''}${pct(r.pctSecoes, 1)} apurado</span></div>
    <div class="barra fina mb"><span style="width:${Math.min(100, r.pctSecoes)}%"></span></div>
    ${linhas || '<div class="vazio">Sem votos apurados.</div>'}
  </button>`;
}

function renderMajoritario(aba) {
  const cargo = ESCOPO_CARGO[aba];
  const el = $('#aba-' + aba);
  const d = estado.dados[cargo];
  const titulo = cargo === 3 ? 'Governadores' : 'Senadores';
  const nota = cargo === 5
    ? 'Em 2026 cada estado elege <b>2 senadores</b>. Os dois mais votados aparecem como “na vaga”.'
    : 'Vence no 1º turno quem tiver mais de 50% dos votos válidos. Se ninguém tiver, há 2º turno.';
  if (!d) { el.innerHTML = `<div class="card vazio">Carregando ${titulo.toLowerCase()}…</div>`; return; }
  const ufs = ufsFiltradas(estado.filtroGrade);
  // resumo: partidos à frente
  const lideres = new Map();
  for (const uf of Object.keys(NOMES_UF)) {
    const r = d.ufs?.[uf];
    const vagas = cargo === 5 ? (r?.vagas || 2) : 1;
    for (const c of (r?.candidatos || []).slice(0, vagas)) {
      if (!c.votos) continue;
      const s = siglaDe(c);
      lideres.set(s, (lideres.get(s) || 0) + 1);
    }
  }
  const resumo = [...lideres].sort((a, b) => b[1] - a[1]).map(([s, n]) =>
    `<span class="pill"><i class="cor-dot" style="background:${corPartido(s)}"></i>${esc(s)} <b>${n}</b></span>`).join('');
  el.innerHTML = `
    <div class="card">
      <h2>${titulo} · ${cargo === 5 ? 'cadeiras em disputa ocupadas agora por partido' : 'estados liderados por partido'}</h2>
      <div class="pills">${resumo || '<span class="vazio">Aguardando votos.</span>'}</div>
      <p class="nota">${nota} Clique em um estado para ver todos os candidatos.</p>
      ${(() => {
        const eleitos = Object.values(d.ufs || {}).flatMap(r => r.candidatos.filter(eleitoDe));
        return eleitos.length ? `<p class="nota"><span class="selo selo-eleito">${ICONE_SELO}ELEITO</span> ${eleitos.length} ${cargo === 5 ? 'senador(es)' : 'governador(es)'} já eleito(s), oficialmente ou matematicamente. Passe o mouse no selo para ver o critério.</p>` : '';
      })()}
    </div>
    ${chipsRegiao(estado.filtroGrade, 'filtro-grade')}
    <div class="uf-grid">${ufs.map(uf => cardMajoritario(cargo, uf, d.ufs?.[uf])).join('')}</div>`;
}

// ---------- Deputados (proporcional) ----------
function waffle(agremiacoes, tamanho) {
  const quadros = [];
  for (const a of agremiacoes) for (let i = 0; i < a.vagas; i++) quadros.push(a);
  return `<div class="waffle" style="--q:${tamanho}px">${quadros.map(a =>
    `<span style="background:${corPartido(a.sigla)}" title="${esc(a.sigla)} · ${a.vagas} vaga(s)"></span>`).join('')}</div>`;
}

function tabelaAgremiacoes(agremiacoes, totalVotos) {
  const linhas = agremiacoes.filter(a => a.vagas > 0 || a.votos > 0).map(a => `<tr>
    <td><span class="cor-dot" style="background:${corPartido(a.sigla)}"></span>${esc(a.sigla)}
      ${a.nome && a.nome !== a.sigla ? `<br><small class="muted">${esc(a.nome)}</small>` : ''}</td>
    <td><b>${a.vagas}</b></td><td>${fmt(a.votos)}</td><td>${pct(totalVotos ? (a.votos / totalVotos) * 100 : 0)}</td></tr>`).join('');
  return `<div class="tabela-wrap"><table class="sem-clique"><thead><tr><th>Partido / federação</th><th>Vagas</th><th>Votos</th><th>% votos</th></tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function seletorEscopo(cargo, atual) {
  const rotuloBR = cargo === 6 ? 'Câmara dos Deputados (Brasil)' : 'Todas as Assembleias (soma)';
  return `<div class="filtros"><label>Abrangência
    <select data-acao="escopo-prop" data-cargo="${cargo}">
      <option value="brasil" ${atual === 'brasil' ? 'selected' : ''}>${rotuloBR}</option>
      ${Object.entries(NOMES_UF).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
        .map(([uf, n]) => `<option value="${uf}" ${atual === uf ? 'selected' : ''}>${n}${cargo === 7 && uf === 'df' ? ' (Distrital)' : ''}</option>`).join('')}
    </select></label></div>`;
}

function listaDeputados(d) {
  const cargoFoto = d.cargo;
  const termo = estado.busca.trim().toLowerCase();
  const todos = d.candidatos.filter(c => c.votos > 0 || termo);
  const filtrados = termo
    ? todos.filter(c => `${c.nome} ${c.nomeCompleto} ${c.numero} ${c.agremiacao}`.toLowerCase().includes(termo))
    : todos;
  const mostra = filtrados.slice(0, estado.limiteCand);
  const linhas = mostra.map(c => {
    const tag = c.eleito ? seloSituacao(c)
      : /suplente/i.test(c.situacao) ? '<span class="tag tag-suave">Suplente</span>'
      : c.projetado ? '<span class="tag tag-suave">Projetado</span>' : '';
    return `<tr class="${c.eleito || c.projetado ? 'destaque' : ''}">
      <td><div class="cel-cand">${avatar(c, cargoFoto, d.uf, corPartido(c.agremiacao), 36)}<div>${esc(c.nome)} ${tag}<br><small class="muted">${esc(c.numero)}</small></div></div></td>
      <td><span class="cor-dot" style="background:${corPartido(c.agremiacao)}"></span>${esc(c.agremiacao)}</td>
      <td>${fmt(c.votos)}</td><td>${pct(c.pct)}</td></tr>`;
  }).join('');
  const mais = filtrados.length > mostra.length
    ? `<p><button class="btn" data-acao="mais-cand">Mostrar mais (${fmt(filtrados.length - mostra.length)} restantes)</button></p>` : '';
  return `<div class="tabela-wrap"><table class="sem-clique"><thead><tr><th>Candidato</th><th>Partido / federação</th><th>Votos</th><th>% válidos</th></tr></thead>
    <tbody>${linhas || '<tr><td colspan="4" class="vazio">Nenhum candidato encontrado.</td></tr>'}</tbody></table></div>${mais}`;
}

function renderProporcional(aba) {
  const cargo = ESCOPO_CARGO[aba];
  const el = $('#aba-' + aba);
  const escopo = estado.prop[cargo];
  const d = estado.dadosProp[cargo + '-' + escopo];
  const titulo = cargo === 6 ? 'Deputados Federais' : 'Deputados Estaduais';
  const topo = seletorEscopo(cargo, escopo);
  const notaProj = '<p class="nota">“Projetado” usa as vagas que o TSE calcula para cada partido ou federação com os votos já apurados (quociente eleitoral e sobras). Dentro de cada agremiação, ficam com as vagas os mais votados que tenham pelo menos 10% do quociente. Isso muda até o fim da apuração.</p>';
  if (estado.fonte === 'demo') { el.innerHTML = topo + '<div class="card vazio">O modo demonstração não cobre deputados. Volte para “Oficial TSE”.</div>'; return; }
  if (!d) { el.innerHTML = topo + `<div class="card vazio">Carregando ${titulo.toLowerCase()}…</div>`; return; }
  if (!d.disponivel) { el.innerHTML = topo + '<div class="card vazio">Aguardando divulgação do TSE.</div>'; return; }

  if (escopo === 'brasil') {
    const totalVotos = d.agremiacoes.reduce((t, a) => t + a.votos, 0);
    const porUF = Object.entries(d.ufs).sort((a, b) => b[1].vagas - a[1].vagas).map(([uf, x]) => {
      const lider = x.agremiacoes[0];
      return `<tr data-acao="escopo-uf" data-valor="${uf}" data-cargo="${cargo}"><td>${NOMES_UF[uf]}</td><td>${x.vagas}</td><td>${pct(x.pctSecoes, 1)}</td>
        <td>${lider ? `<span class="cor-dot" style="background:${corPartido(lider.sigla)}"></span>${esc(lider.sigla)} ${lider.vagas}` : '—'}</td></tr>`;
    }).join('');
    el.innerHTML = `${topo}
      <div class="grid-topo">
        <div class="card">
          <h2>${cargo === 6 ? 'Câmara dos Deputados' : 'Assembleias Legislativas (soma)'} · bancada projetada</h2>
          ${blocoProgresso({ pctSecoes: d.pctSecoes, secoesTotalizadas: 0, secoes: 0 }).replace(/<span>0 de 0<\/span>/, '<span>soma das 27 UFs</span>')}
          ${waffle(d.agremiacoes, cargo === 6 ? 13 : 9)}
          <p class="nota">${d.vagas} cadeiras · cada quadrado é uma cadeira.</p>
          ${notaProj}
        </div>
        <div class="card"><h2>Por partido / federação</h2>${tabelaAgremiacoes(d.agremiacoes, totalVotos)}</div>
      </div>
      <div class="card"><h2>Por estado</h2><div class="tabela-wrap"><table>
        <thead><tr><th>Estado</th><th>Vagas</th><th>Apurado</th><th>Maior bancada</th></tr></thead><tbody>${porUF}</tbody></table></div></div>`;
    return;
  }

  const totalVotos = d.agremiacoes.reduce((t, a) => t + a.votos, 0);
  el.innerHTML = `${topo}
    <div class="grid-topo">
      <div class="card">
        <h2>${esc(d.cargoNome)} · ${NOMES_UF[escopo]}</h2>
        ${blocoProgresso(d)}
        <div class="numeros mb">
          <div class="num"><span>Vagas</span><b>${d.vagas}</b></div>
          <div class="num"><span>Quociente eleitoral</span><b>${fmt(d.quociente)}</b></div>
          <div class="num"><span>Votos válidos</span><b>${fmt(d.validos)}</b></div>
        </div>
        ${waffle(d.agremiacoes, 18)}
        ${notaProj}
      </div>
      <div class="card"><h2>Vagas por partido / federação</h2>${tabelaAgremiacoes(d.agremiacoes, totalVotos)}</div>
    </div>
    <div class="card">
      <div class="regiao-head"><h2 style="margin:0">Candidatos</h2>
        <input type="search" id="buscaCand" placeholder="Buscar por nome, número ou partido" value="${esc(estado.busca)}"></div>
      <div id="listaDep">${listaDeputados(d)}</div>
    </div>`;
}

// ---------- registro das abas ----------
async function carregarMajoritario(cargo) {
  estado.dados[cargo] = await buscar(cargo);
}
async function carregarProporcional(cargo) {
  if (estado.fonte === 'demo') return;
  const escopo = estado.prop[cargo];
  const url = escopo === 'brasil' ? `/api/bancada?cargo=${cargo}` : `/api/proporcional?cargo=${cargo}&uf=${escopo}`;
  const r = await fetch(url);
  if (r.ok) estado.dadosProp[cargo + '-' + escopo] = await r.json();
}
for (const aba of ['governadores', 'senadores']) {
  ABAS_EXTRA[aba] = { carregar: () => carregarMajoritario(ESCOPO_CARGO[aba]), render: () => renderMajoritario(aba) };
}
for (const aba of ['depfed', 'depest']) {
  ABAS_EXTRA[aba] = { carregar: () => carregarProporcional(ESCOPO_CARGO[aba]), render: () => renderProporcional(aba) };
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-acao]');
  if (!t || t.tagName === 'SELECT') return;
  const { acao, valor } = t.dataset;
  if (acao === 'filtro-grade') { estado.filtroGrade = valor; ABAS_EXTRA[estado.aba].render(); }
  else if (acao === 'mais-cand') { estado.limiteCand += 100; ABAS_EXTRA[estado.aba].render(); }
  else if (acao === 'escopo-uf') trocarEscopo(Number(t.dataset.cargo), valor);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset?.acao === 'escopo-prop') trocarEscopo(Number(t.dataset.cargo), t.value);
});
document.addEventListener('input', e => {
  if (e.target.id !== 'buscaCand') return;
  estado.busca = e.target.value;
  estado.limiteCand = 60;
  const cargo = ESCOPO_CARGO[estado.aba];
  const d = estado.dadosProp[cargo + '-' + estado.prop[cargo]];
  if (d) $('#listaDep').innerHTML = listaDeputados(d);
});
function trocarEscopo(cargo, escopo) {
  estado.prop[cargo] = escopo;
  estado.busca = '';
  estado.limiteCand = 60;
  window.scrollTo({ top: 0 });
  ABAS_EXTRA[estado.aba].render();
  atualizar();
}
