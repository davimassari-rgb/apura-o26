// Aba "2022 × 2026": Presidente – Jair (2022) e Flávio (2026) frente a Lula (2022 e 2026).
// 2026 é sempre o 1º turno; 2022 pode ser o 1º ou o 2º turno (seletor no topo da aba).
// Depende de app.js (estado, $, fmt, pct, esc, NOMES_UF, ABAS_EXTRA)

// Paleta validada (scripts/validate_palette.js do skill de dataviz) para claro e escuro.
// 2022 = tom mais claro; 2026 = tom pleno. Rótulos diretos compensam o contraste < 3:1.
const SERIES = [
  { chave: 'jair22', rotulo: 'Jair Bolsonaro 2022', curto: 'Jair 22', var: '--c-jair22' },
  { chave: 'flavio26', rotulo: 'Flávio Bolsonaro 2026', curto: 'Flávio 26', var: '--c-flavio26' },
  { chave: 'lula22', rotulo: 'Lula 2022', curto: 'Lula 22', var: '--c-lula22' },
  { chave: 'lula26', rotulo: 'Lula 2026', curto: 'Lula 26', var: '--c-lula26' },
];
Object.assign(estado, { comp: null, filtroComp: 'todas', zoomCurva: true, turno2022: 1 });

// Rótulo de 2022 conforme o turno escolhido
const rot22 = () => (estado.turno2022 === 2 ? '2022 (2º turno)' : '2022 (1º turno)');
function aplicarTurno() {
  const t = estado.turno2022 === 2 ? ' 2ºT' : '';
  Object.assign(SERIES[0], { rotulo: `Jair Bolsonaro ${rot22()}`, curto: `Jair 22${t}` });
  Object.assign(SERIES[2], { rotulo: `Lula ${rot22()}`, curto: `Lula 22${t}` });
  Object.assign(SERIES[1], { rotulo: 'Flávio Bolsonaro 2026 (1º turno)' });
  Object.assign(SERIES[3], { rotulo: 'Lula 2026 (1º turno)' });
}
aplicarTurno();

const pp = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' p.p.';
const legenda = (series = SERIES) => `<div class="legenda esquerda">${series.map(s =>
  `<span><i style="background:var(${s.var})"></i>${s.rotulo}</span>`).join('')}</div>`;

// ---------- tooltip compartilhado ----------
function mostrarTooltip(ev, html) {
  const tip = $('#tooltip');
  tip.innerHTML = html;
  tip.hidden = false;
  const { innerWidth: w } = window;
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > w - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - 14;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function esconderTooltip() { $('#tooltip').hidden = true; }

// ---------- 1. KPIs ----------
function kpis(b) {
  // fotos: 2022 vêm do pacote oficial "Fotos de candidatos 2022 – BR" (public/fotos/2022);
  // 2026 vêm do TSE pelo proxy local
  const FOTO22 = { Jair: '/fotos/2022/280001618036.jpg', Lula: '/fotos/2022/280001607829.jpg' };
  const foto26 = n => fotoUrl(1, 'br', n === 'Flávio' ? b.sqFlavio26 : b.sqLula26);
  const rosto = (nome, url, varCor) => avatar({ nome }, 1, 'br', `var(${varCor})`, 44, url);
  const tile = (rot, v22, v26, n22, n26, s22, s26) => {
    const delta = v26 != null && v22 != null ? v26 - v22 : null;
    return `<div class="card kpi">
      <h2>${rot}</h2>
      <div class="kpi-linha">
        <div class="kpi-pessoa">${rosto(n22, FOTO22[n22], s22)}<div><span class="kpi-ano"><i style="background:var(${s22})"></i>${n22} · ${rot22()}</span><b>${v22 != null ? pct(v22) : '—'}</b></div></div>
        <div class="kpi-seta">→</div>
        <div class="kpi-pessoa">${rosto(n26, foto26(n26), s26)}<div><span class="kpi-ano"><i style="background:var(${s26})"></i>${n26} · 2026</span><b>${v26 != null ? pct(v26) : '—'}</b></div></div>
      </div>
      <div class="kpi-delta">${delta != null ? `Variação: <b>${pp(delta)}</b>` : 'Aguardando 2026'}</div>
    </div>`;
  };
  const m22 = b.jair22 - b.lula22, m26 = (b.flavio26 ?? 0) - (b.lula26 ?? 0);
  return `<div class="kpis">
    ${tile('Família Bolsonaro', b.jair22, b.flavio26, 'Jair', 'Flávio', '--c-jair22', '--c-flavio26')}
    ${tile('Lula', b.lula22, b.lula26, 'Lula', 'Lula', '--c-lula22', '--c-lula26')}
    <div class="card kpi">
      <h2>Diferença Bolsonaro − Lula</h2>
      <div class="kpi-linha">
        <div><span class="kpi-ano">${rot22()}</span><b>${pp(m22)}</b></div>
        <div class="kpi-seta">→</div>
        <div><span class="kpi-ano">2026</span><b>${b.lula26 != null ? pp(m26) : '—'}</b></div>
      </div>
      <div class="kpi-delta">2026 com ${pct(b.pctSecoes26, 1)} das seções apuradas</div>
    </div>
  </div>`;
}

// ---------- 2. Barras agrupadas: Brasil + regiões ----------
function barrasAgrupadas(grupos) {
  const W = 760, H = 300, m = { t: 22, r: 8, b: 34, l: 36 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const max = Math.max(70, ...grupos.flatMap(g => SERIES.map(s => g[s.chave] || 0)));
  const yMax = Math.ceil(max / 10) * 10;
  const y = v => m.t + ih - (v / yMax) * ih;
  const gw = iw / grupos.length, bw = Math.min(26, (gw - 18) / 4), gap = 2;
  let svg = '';
  for (let v = 0; v <= yMax; v += 10) {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="grade-linha"/>
      <text x="${m.l - 6}" y="${y(v) + 4}" class="eixo" text-anchor="end">${v}%</text>`;
  }
  grupos.forEach((g, gi) => {
    const x0 = m.l + gi * gw + (gw - (bw * 4 + gap * 3)) / 2;
    SERIES.forEach((s, si) => {
      const v = g[s.chave];
      if (v == null) return;
      const x = x0 + si * (bw + gap), h = (v / yMax) * ih, yy = y(v);
      const r = Math.min(4, bw / 2, h);
      // topo arredondado, base reta ancorada no zero
      svg += `<path d="M${x},${y(0)} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${y(0)} Z"
        fill="var(${s.var})" class="marca" data-tip="${esc(`<b>${g.nome}</b><br>${s.rotulo}: <b>${pct(v)}</b>`)}"/>`;
      svg += `<text x="${x + bw / 2}" y="${yy - 5}" class="rotulo-barra" text-anchor="middle">${Math.round(v)}</text>`;
    });
    svg += `<text x="${m.l + gi * gw + gw / 2}" y="${H - 10}" class="eixo forte" text-anchor="middle">${esc(g.nome)}</text>`;
  });
  svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" class="base-linha"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="grafico" role="img" aria-label="Percentual de votos válidos por região, 2022 e 2026">${svg}</svg>`;
}

// ---------- 3. Curva da apuração: % válidos x % seções apuradas ----------
// xMin > 0 dá zoom no trecho final da apuração (onde 2026 tem pontos gravados)
function curvaApuracao(h22, h26, xMin = 0) {
  h22 = h22.filter(p => p.pctSecoes >= Math.max(1, xMin)); // descarta o ruído dos primeiríssimos boletins
  h26 = h26.filter(p => p.pctSecoes >= xMin);
  const W = 760, H = 320, m = { t: 16, r: 120, b: 40, l: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const todos = [...h22.flatMap(p => [p.lula, p.jair]), ...h26.flatMap(p => [p.lula, p.flavio])].filter(Number.isFinite);
  const passoY = xMin > 0 ? 2 : 5;
  const yMin = Math.floor((Math.min(...todos) - 1) / passoY) * passoY;
  const yMax = Math.ceil((Math.max(...todos) + 1) / passoY) * passoY;
  const x = v => m.l + ((v - xMin) / (100 - xMin)) * iw;
  const y = v => m.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const caminho = (pts, k) => pts.filter(p => Number.isFinite(p[k])).map((p, i) => `${i ? 'L' : 'M'}${x(p.pctSecoes).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  let svg = '';
  for (let v = yMin; v <= yMax; v += passoY) svg += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}" class="grade-linha"/><text x="${m.l - 6}" y="${y(v) + 4}" class="eixo" text-anchor="end">${v}%</text>`;
  const passoX = 100 - xMin <= 30 ? 5 : 20;
  for (let v = Math.ceil(xMin / passoX) * passoX; v <= 100; v += passoX) svg += `<text x="${x(v)}" y="${H - 18}" class="eixo" text-anchor="middle">${v}%</text>`;
  svg += `<text x="${m.l + iw / 2}" y="${H - 2}" class="eixo" text-anchor="middle">seções totalizadas</text>`;
  if (yMin < 50 && yMax > 50) svg += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(50)}" y2="${y(50)}" class="linha-50"/><text x="${m.l + 4}" y="${y(50) - 5}" class="eixo">50%</text>`;
  const linhas = [
    ['jair22', h22, 'jair'], ['lula22', h22, 'lula'], ['flavio26', h26, 'flavio'], ['lula26', h26, 'lula'],
  ];
  const rotulos = [];
  for (const [s, pts, k] of linhas) {
    const serie = SERIES.find(z => z.chave === s);
    const d = caminho(pts, k);
    if (!d) continue;
    const e22 = s.endsWith('22');
    svg += `<path d="${d}" fill="none" stroke="var(${serie.var})" stroke-width="${e22 ? 2 : 2.5}" stroke-linejoin="round" ${e22 ? 'stroke-dasharray="5 4"' : ''}/>`;
    const ult = pts[pts.length - 1];
    svg += `<circle cx="${x(ult.pctSecoes)}" cy="${y(ult[k])}" r="4" fill="var(${serie.var})" stroke="var(--card)" stroke-width="2"/>`;
    rotulos.push({ x: x(ult.pctSecoes), y: y(ult[k]), texto: `${serie.curto} ${pct(ult[k], 1)}`, cor: serie.var });
  }
  // rótulos diretos no fim de cada linha, afastados para não se sobreporem
  rotulos.sort((a, b) => a.y - b.y);
  for (let i = 1; i < rotulos.length; i++) if (rotulos[i].y - rotulos[i - 1].y < 14) rotulos[i].y = rotulos[i - 1].y + 14;
  for (const r of rotulos) {
    svg += `<text x="${r.x + 9}" y="${r.y + 4}" class="eixo forte rotulo-linha">${esc(r.texto)}</text>`;
  }
  svg += `<line class="mira" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>`;
  svg += `<rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" class="area-hover"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="grafico" id="curva" data-ml="${m.l}" data-iw="${iw}" data-xmin="${xMin}" role="img"
    aria-label="Evolução do percentual de votos válidos ao longo da apuração, 2022 e 2026">${svg}</svg>`;
}

function interpolar(pts, k, alvo) {
  if (!pts.length || alvo < pts[0].pctSecoes || alvo > pts[pts.length - 1].pctSecoes) return null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (alvo <= b.pctSecoes) {
      const t = b.pctSecoes === a.pctSecoes ? 1 : (alvo - a.pctSecoes) / (b.pctSecoes - a.pctSecoes);
      return a[k] + (b[k] - a[k]) * t;
    }
  }
  return pts[pts.length - 1][k];
}

// ---------- 4. Halteres: diferença Bolsonaro − Lula por estado ----------
function halteres(ufs) {
  const linhas = ufs.filter(u => u.m26 != null).sort((a, b) => b.m26 - a.m26);
  const semDados = ufs.filter(u => u.m26 == null);
  const lim = Math.ceil(Math.max(20, ...linhas.flatMap(u => [Math.abs(u.m22), Math.abs(u.m26)])) / 10) * 10;
  const W = 760, rowH = 22, m = { t: 44, r: 70, b: 8, l: 130 };
  const H = m.t + m.b + (linhas.length + semDados.length) * rowH;
  const iw = W - m.l - m.r;
  const x = v => m.l + ((v + lim) / (2 * lim)) * iw;
  let svg = '';
  for (let v = -lim; v <= lim; v += 10) {
    svg += `<line x1="${x(v)}" x2="${x(v)}" y1="${m.t - 6}" y2="${H - m.b}" class="${v === 0 ? 'base-linha' : 'grade-linha'}"/>
      <text x="${x(v)}" y="${m.t - 12}" class="eixo" text-anchor="middle">${v === 0 ? '0' : (v > 0 ? '+' : '−') + Math.abs(v)}</text>`;
  }
  svg += `<text x="${x(-lim)}" y="${12}" class="eixo forte" text-anchor="start">← Lula à frente</text>
    <text x="${x(lim)}" y="${12}" class="eixo forte" text-anchor="end">Bolsonaro à frente →</text>`;
  linhas.forEach((u, i) => {
    const cy = m.t + i * rowH + rowH / 2;
    const cor26 = u.m26 >= 0 ? 'var(--c-flavio26)' : 'var(--c-lula26)';
    const tip = esc(`<b>${u.nome}</b> · ${pct(u.pctSecoes26, 1)} apurado<br>${rot22()} (Jair − Lula): <b>${pp(u.m22)}</b><br>2026 (Flávio − Lula): <b>${pp(u.m26)}</b><br>Mudança: <b>${pp(u.m26 - u.m22)}</b>`);
    svg += `<g class="linha-uf" data-tip="${tip}" data-uf="${u.uf}">
      <rect x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}" fill="transparent"/>
      <text x="${m.l - 10}" y="${cy + 4}" class="eixo forte" text-anchor="end">${esc(u.nome)}</text>
      <line x1="${x(u.m22)}" x2="${x(u.m26)}" y1="${cy}" y2="${cy}" class="haste"/>
      <circle cx="${x(u.m22)}" cy="${cy}" r="5" class="ponto22"/>
      <circle cx="${x(u.m26)}" cy="${cy}" r="5.5" fill="${cor26}" stroke="var(--card)" stroke-width="2"/>
      <text x="${W - m.r + 8}" y="${cy + 4}" class="eixo">${pp(u.m26 - u.m22, 1)}</text>
    </g>`;
  });
  semDados.forEach((u, i) => {
    const cy = m.t + (linhas.length + i) * rowH + rowH / 2;
    svg += `<text x="${m.l - 10}" y="${cy + 4}" class="eixo" text-anchor="end">${esc(u.nome)}</text><text x="${m.l}" y="${cy + 4}" class="eixo">aguardando 2026</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="grafico" role="img" aria-label="Diferença entre Bolsonaro e Lula por estado, 2022 e 2026">${svg}</svg>`;
}

// ---------- 5. Tabela ----------
function tabelaComp(linhas) {
  const c = v => (v != null ? pct(v) : '—');
  const d = v => (v != null ? pp(v) : '—');
  return `<div class="tabela-wrap"><table class="sem-clique"><thead><tr>
    <th>Local</th><th>Apurado 2026</th><th>Jair 22</th><th>Flávio 26</th><th>Δ</th><th>Lula 22</th><th>Lula 26</th><th>Δ</th></tr></thead>
    <tbody>${linhas.map(l => `<tr><td>${esc(l.nome)}</td><td>${pct(l.pctSecoes26, 1)}</td>
      <td>${c(l.jair22)}</td><td>${c(l.flavio26)}</td><td>${l.flavio26 != null ? d(l.flavio26 - l.jair22) : '—'}</td>
      <td>${c(l.lula22)}</td><td>${c(l.lula26)}</td><td>${l.lula26 != null ? d(l.lula26 - l.lula22) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- render ----------
function renderComparativo() {
  const el = $('#aba-comparativo');
  const d = estado.comp;
  if (!d) { el.innerHTML = '<div class="card vazio">Carregando comparativo…</div>'; return; }
  if (!d.disponivel2022) { el.innerHTML = '<div class="card vazio">Arquivo de 2022 não encontrado em <code>data/</code>. Rode <code>node scripts/gerar-2022.js</code>.</div>'; return; }
  const b = { nome: 'Brasil', ...d.brasil };
  const regs = Object.values(d.regioes);
  const ufs = Object.entries(d.ufs).map(([uf, x]) => ({
    uf, nome: NOMES_UF[uf], ...x,
    m22: x.jair22 - x.lula22, m26: x.flavio26 != null && x.lula26 != null ? x.flavio26 - x.lula26 : null,
  }));
  const filtro = estado.filtroComp;
  const h26 = d.historico2026;
  const zoom = estado.zoomCurva && h26.length > 0;
  const xMinZoom = h26.length ? Math.max(0, Math.floor((h26[0].pctSecoes - 5) / 5) * 5) : 0;
  const ufsVis = filtro === 'todas' ? ufs : ufs.filter(u => UFS_REGIAO[filtro].includes(u.uf));

  const turnoCarregado = d.turno2022 || 1;
  const seletor = `<div class="card seletor-turno">
      <div><h2 style="margin:0 0 4px">Comparar 2026 (1º turno) com</h2>
        <span class="muted">${turnoCarregado === 2
          ? 'No 2º turno de 2022 só havia Lula e Jair, então os dois somam 100% dos válidos. Em 2026, no 1º turno, os votos se dividem entre vários candidatos. Compare com isso em mente.'
          : 'Mesma fase da eleição: 1º turno contra 1º turno.'}</span></div>
      <div class="seg">${[1, 2].map(t => `<button data-acao="turno-2022" data-valor="${t}" class="${turnoCarregado === t ? 'ativo' : ''}" ${(d.turnosDisponiveis2022 || [1]).includes(t) ? '' : 'disabled'}>${t}º turno de 2022</button>`).join('')}</div>
    </div>`;
  el.innerHTML = `
    ${seletor}
    ${estado.fonte === 'demo' ? '<div class="card nota">Esta aba sempre usa os dados oficiais do TSE, mesmo no modo demonstração.</div>' : ''}
    ${kpis(b)}
    <div class="card">
      <h2>Votos válidos · Brasil e regiões</h2>
      ${legenda()}
      ${barrasAgrupadas([b, ...regs])}
      <p class="nota">2026 é parcial: ${pct(b.pctSecoes26, 1)} das seções apuradas no Brasil. Os percentuais são sobre os votos válidos de cada recorte.</p>
    </div>
    <div class="card">
      <div class="regiao-head"><h2 style="margin:0">Curva da apuração · Brasil</h2>
        <div class="seg"><button data-acao="zoom-curva" data-valor="1" class="${zoom ? 'ativo' : ''}">Trecho com dados de 2026</button><button data-acao="zoom-curva" data-valor="0" class="${zoom ? '' : 'ativo'}">Apuração inteira</button></div></div>
      ${legenda()}
      <div class="grafico-wrap">${curvaApuracao(d.historico2022, d.historico2026, zoom ? xMinZoom : 0)}</div>
      <p class="nota">Linhas tracejadas: ${rot22()}, histórico oficial do TSE. Linhas contínuas: 2026 (1º turno), gravadas por este painel a cada boletim do TSE desde ${h26.length ? pct(h26[0].pctSecoes, 1) : '—'} das seções. O TSE não publica os boletins anteriores de 2026, então o trecho antes disso não pode ser reconstruído com dados oficiais. Passe o mouse para comparar os dois anos no mesmo ponto da apuração.</p>
    </div>
    <div class="card">
      <h2>Diferença Bolsonaro − Lula por estado (pontos percentuais)</h2>
      <div class="legenda esquerda"><span><i class="anel"></i>${rot22()} · Jair − Lula</span><span><i style="background:var(--c-flavio26)"></i>2026 · Flávio à frente</span><span><i style="background:var(--c-lula26)"></i>2026 · Lula à frente</span><span class="muted">À direita: mudança entre 2022 e 2026</span></div>
      ${chipsRegiao(filtro, 'filtro-comp')}
      ${halteres(ufsVis)}
    </div>
    <div class="card">
      <h2>Tabela</h2>
      ${tabelaComp([b, ...regs, ...ufsVis.sort((a, z) => a.nome.localeCompare(z.nome, 'pt-BR')), { nome: 'Exterior', ...d.exterior }])}
      <p class="nota">Fontes: 2022, ${esc(d.fontes.y2022 || '')}. Curva de 2022: ${esc(d.fontes.historico2022 || '')}. 2026: arquivos de resultado do TSE (resultados.tse.jus.br).</p>
    </div>`;
}

ABAS_EXTRA.comparativo = {
  carregar: async () => { const r = await fetch('/api/comparativo?turno2022=' + estado.turno2022); if (r.ok) estado.comp = await r.json(); },
  render: renderComparativo,
};

// ---------- interações ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-acao="filtro-comp"], [data-acao="zoom-curva"], [data-acao="turno-2022"]');
  if (!t) return;
  if (t.dataset.acao === 'turno-2022') {
    estado.turno2022 = Number(t.dataset.valor);
    aplicarTurno();
    atualizar(); // busca o comparativo do turno escolhido e redesenha
    return;
  }
  if (t.dataset.acao === 'filtro-comp') estado.filtroComp = t.dataset.valor;
  else estado.zoomCurva = t.dataset.valor === '1';
  renderComparativo();
});
document.addEventListener('mousemove', e => {
  const alvo = e.target.closest?.('[data-tip]');
  if (alvo) return mostrarTooltip(e, alvo.dataset.tip);
  const svg = e.target.closest?.('#curva');
  if (svg && estado.comp) {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const ml = +svg.dataset.ml, iw = +svg.dataset.iw;
    const xMin = +svg.dataset.xmin || 0;
    const sec = Math.max(xMin, Math.min(100, xMin + ((loc.x - ml) / iw) * (100 - xMin)));
    const mira = svg.querySelector('.mira');
    mira.setAttribute('x1', loc.x); mira.setAttribute('x2', loc.x); mira.setAttribute('visibility', 'visible');
    const { historico2022: h22, historico2026: h26 } = estado.comp;
    const val = [
      ['jair22', interpolar(h22, 'jair', sec)], ['flavio26', interpolar(h26, 'flavio', sec)],
      ['lula22', interpolar(h22, 'lula', sec)], ['lula26', interpolar(h26, 'lula', sec)],
    ];
    mostrarTooltip(e, `<b>${pct(sec, 1)} das seções</b><br>${val.map(([k, v]) => {
      const s = SERIES.find(z => z.chave === k);
      return `<span class="tip-linha"><i style="background:var(${s.var})"></i>${s.rotulo}: <b>${v != null ? pct(v) : '—'}</b></span>`;
    }).join('')}`);
    return;
  }
  document.querySelectorAll('#curva .mira').forEach(m => m.setAttribute('visibility', 'hidden'));
  esconderTooltip();
});
