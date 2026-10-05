// Abas "Mercado" (Ibovespa e dólar) e "Apostas" (Polymarket e Kalshi, presidente 2026)
// Depende de app.js (estado, $, fmt, pct, esc, ABAS_EXTRA, mostrarAviso) e de comparativo.js (mostrarTooltip, esconderTooltip)

Object.assign(estado, { mercado: null, rangeMercado: '1d', previsoes: null, periodoPrev: '1w' });
const COR_CAND = { flavio: '#2563eb', lula: '#dc2626' }; // as mesmas cores do painel
const TZ = 'America/Sao_Paulo';
const fmtNum = (v, casas) => (v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }));
const fmtVar = (v, casas = 2, suf = '%') => {
  if (v == null || !Number.isFinite(v)) return '—';
  const r = Number(v.toFixed(casas));
  if (r === 0) return '0,' + '0'.repeat(casas) + suf; // evita "-0,00%"
  return (r > 0 ? '▲ +' : '▼ −') + Math.abs(r).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + suf;
};
const classeVar = v => (v == null || Math.abs(v) < 0.005 ? 'neutra' : v > 0 ? 'alta' : 'baixa');
const fmtHora = (ms, comData) => new Date(ms).toLocaleString('pt-BR', comData
  ? { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
  : { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtUSD = v => (v == null ? '—' : 'US$ ' + (v >= 1e6 ? fmtNum(v / 1e6, 1) + ' mi' : fmtNum(v / 1e3, 0) + ' mil'));

// ---------- gráfico de linha (SVG) com mira e tooltip ----------
const GRAFICOS = new Map(); // id -> { series, x, formatoY, formatoX, ml, iw }
let seqGraf = 0;
function graficoLinha({ series, formatoY, formatoX, linhasRef = [], altura = 260, area = false, dominioY }) {
  const id = 'gl' + (++seqGraf);
  const pts = series.flatMap(s => s.pontos);
  if (!pts.length) return '<div class="vazio">Sem dados no período.</div>';
  const W = 760, H = altura, m = { t: 14, r: 92, b: 30, l: 64 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const xs = pts.map(p => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
  let ys = pts.map(p => p[1]).concat(linhasRef.map(r => r.valor).filter(v => v != null));
  let y0 = dominioY ? dominioY[0] : Math.min(...ys), y1 = dominioY ? dominioY[1] : Math.max(...ys);
  if (!dominioY) { const pad = (y1 - y0) * 0.12 || Math.abs(y1) * 0.01 || 1; y0 -= pad; y1 += pad; }
  const x = t => m.l + ((t - x0) / (x1 - x0 || 1)) * iw;
  const y = v => m.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  let svg = '';
  for (let k = 0; k <= 4; k++) {
    const v = y0 + ((y1 - y0) * k) / 4;
    svg += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}" class="grade-linha"/><text x="${m.l - 8}" y="${y(v) + 4}" class="eixo" text-anchor="end">${esc(formatoY(v))}</text>`;
  }
  for (let k = 0; k <= 4; k++) {
    const t = x0 + ((x1 - x0) * k) / 4;
    svg += `<text x="${x(t)}" y="${H - 8}" class="eixo" text-anchor="${k === 0 ? 'start' : k === 4 ? 'end' : 'middle'}">${esc(formatoX(t))}</text>`;
  }
  for (const r of linhasRef) {
    if (r.valor != null && r.valor >= y0 && r.valor <= y1) svg += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(r.valor)}" y2="${y(r.valor)}" class="linha-ref"/><text x="${m.l + iw + 6}" y="${y(r.valor) + 4}" class="eixo">${esc(r.rotulo)}</text>`;
    if (r.tempo != null && r.tempo >= x0 && r.tempo <= x1) svg += `<line x1="${x(r.tempo)}" x2="${x(r.tempo)}" y1="${m.t}" y2="${m.t + ih}" class="linha-ref"/><text x="${x(r.tempo) + 6}" y="${m.t + 12}" class="eixo">${esc(r.rotulo)}</text>`;
  }
  const rotulos = [];
  for (const s of series) {
    if (!s.pontos.length) continue;
    const d = s.pontos.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
    if (area) svg += `<path d="${d} L${x(s.pontos[s.pontos.length - 1][0]).toFixed(1)},${m.t + ih} L${x(s.pontos[0][0]).toFixed(1)},${m.t + ih} Z" fill="${s.cor}" opacity=".12"/>`;
    svg += `<path d="${d}" fill="none" stroke="${s.cor}" stroke-width="2" stroke-linejoin="round" ${s.tracejado ? 'stroke-dasharray="6 4"' : ''}/>`;
    const u = s.pontos[s.pontos.length - 1];
    svg += `<circle cx="${x(u[0])}" cy="${y(u[1])}" r="4" fill="${s.cor}" stroke="var(--card)" stroke-width="2"/>`;
    if (s.rotulo) rotulos.push({ y: y(u[1]), x: x(u[0]), t: s.rotulo });
  }
  rotulos.sort((a, b) => a.y - b.y);
  for (let i = 1; i < rotulos.length; i++) if (rotulos[i].y - rotulos[i - 1].y < 14) rotulos[i].y = rotulos[i - 1].y + 14;
  for (const r of rotulos) svg += `<text x="${r.x + 8}" y="${r.y + 4}" class="eixo forte">${esc(r.t)}</text>`;
  svg += `<line class="mira" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
  GRAFICOS.set(id, { series, formatoY, x0, x1, ml: m.l, iw });
  return `<svg viewBox="0 0 ${W} ${H}" class="grafico graf-linha" id="${id}" role="img" aria-label="${esc(series.map(s => s.nome).join(', '))}">${svg}</svg>`;
}
document.addEventListener('mousemove', e => {
  const svg = e.target.closest?.('.graf-linha');
  if (!svg) { document.querySelectorAll('.graf-linha .mira').forEach(m => m.setAttribute('visibility', 'hidden')); return; }
  const g = GRAFICOS.get(svg.id);
  if (!g) return;
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
  const t = g.x0 + ((loc.x - g.ml) / g.iw) * (g.x1 - g.x0);
  const mira = svg.querySelector('.mira');
  mira.setAttribute('x1', loc.x); mira.setAttribute('x2', loc.x); mira.setAttribute('visibility', 'visible');
  const linhas = g.series.filter(s => s.pontos.length).map(s => {
    let melhor = s.pontos[0];
    for (const p of s.pontos) if (Math.abs(p[0] - t) < Math.abs(melhor[0] - t)) melhor = p;
    return `<span class="tip-linha"><i style="background:${s.cor}"></i>${esc(s.nome)}: <b>${esc(g.formatoY(melhor[1], true))}</b></span>`;
  });
  mostrarTooltip(e, `<b>${esc(fmtHora(t, true))}</b><br>${linhas.join('')}`);
});

// ---------- aba Mercado ----------
function cardAtivo(a, range) {
  if (a.erro) return `<div class="card"><h2>${esc(a.nome)}</h2><div class="vazio">Não foi possível obter os dados agora (${esc(a.erro)}).</div></div>`;
  const casas = a.casas;
  const fy = (v, tip) => (a.unidade === 'R$' ? 'R$ ' + fmtNum(v, tip ? 4 : 3) : fmtNum(v, 0));
  const fx = t => fmtHora(t, range !== '1d');
  const serie = { nome: a.nome, cor: a.chave === 'dolar' ? 'var(--c-dolar)' : 'var(--accent)', pontos: a.serie };
  const refs = [];
  if (range === '1d' && a.anterior != null) refs.push({ valor: a.anterior, rotulo: 'fech. ant.' });
  if (a.preEleicao && range !== '1d') refs.push({ tempo: Date.parse('2026-10-04T00:00:00-03:00'), rotulo: '1º turno' });
  return `<div class="card ativo">
    <div class="regiao-head"><h2 style="margin:0">${esc(a.nome)}</h2><span class="muted">${esc(fmtHora(a.hora, true))}</span></div>
    <div class="ativo-preco"><b>${a.unidade === 'R$' ? 'R$ ' + fmtNum(a.preco, casas) : fmtNum(a.preco, 0)}</b>${a.unidade === 'pontos' ? '<small>pontos</small>' : ''}
      <span class="var ${classeVar(a.variacao)}">${fmtVar(a.variacao)}</span></div>
    <div class="muted ativo-sub">${range === '1d' ? 'Variação do dia' : 'Variação no período'} · ${range === '1d' ? 'fechamento anterior' : 'início do período'}: ${a.unidade === 'R$' ? 'R$ ' + fmtNum(a.anterior, casas) : fmtNum(a.anterior, 0)}</div>
    ${a.preEleicao ? `<div class="reacao"><span>Reação ao 1º turno</span><b class="${classeVar(a.variacaoEleicao)}">${fmtVar(a.variacaoEleicao)}</b><small>desde o fechamento de ${esc(a.preEleicao.dataTexto)}, último pregão antes da eleição</small></div>` : ''}
    <div class="grafico-wrap">${graficoLinha({ series: [serie], formatoY: fy, formatoX: fx, linhasRef: refs, area: true })}</div>
  </div>`;
}
function renderMercado() {
  const el = $('#aba-mercado');
  const d = estado.mercado;
  const seg = `<div class="seg">${[['1d', '1 dia'], ['5d', '5 dias'], ['1mo', '1 mês']].map(([k, n]) => `<button data-acao="range-mercado" data-valor="${k}" class="${estado.rangeMercado === k ? 'ativo' : ''}">${n}</button>`).join('')}</div>`;
  const topo = `<div class="card seletor-turno">
      <div><h2 style="margin:0 0 4px">Mercado financeiro · Ibovespa e dólar</h2>
        <span class="muted">Como o mercado reage à eleição. Atualiza a cada 30 s. Fonte: Yahoo Finance (Ibovespa com atraso de até 15 min). Informativo, não é recomendação de investimento.</span></div>
      ${seg}</div>`;
  if (!d) { el.innerHTML = topo + '<div class="card vazio">Carregando cotações…</div>'; return; }
  el.innerHTML = topo + `<div class="mercado-grid">${d.ativos.map(a => cardAtivo(a, d.range)).join('')}</div>
    <p class="nota" style="text-align:center">Consultado às ${esc(fmtHora(Date.parse(d.consultadoEm), true))} (horário de Brasília).</p>`;
}

// ---------- aba Apostas ----------
function cardPlataforma(p) {
  if (p.erro) return `<div class="card"><h2>${esc(p.plataforma)}</h2><div class="vazio">Não foi possível obter os dados agora (${esc(p.erro)}).</div></div>`;
  const linhas = p.candidatos.map(c => `
    <div class="aposta">
      <div class="aposta-topo"><span class="nm"><i class="cor-dot" style="background:${COR_CAND[c.chave]}"></i>${esc(c.nome)}</span>
        <b>${c.prob == null ? '—' : pct(c.prob * 100, 1)}</b></div>
      <div class="barra"><span style="width:${(c.prob || 0) * 100}%;background:${COR_CAND[c.chave]}"></span></div>
      <div class="muted aposta-sub">24 h: <span class="${classeVar(c.var24h)}">${fmtVar(c.var24h == null ? null : c.var24h * 100, 1, ' p.p.')}</span>${c.compra != null ? ` · compra US$ ${fmtNum(c.compra, 2)} · venda US$ ${fmtNum(c.venda, 2)}` : ''}</div>
    </div>`).join('');
  const outros = p.outros?.length ? `<p class="nota">Outros nomes no mercado: ${p.outros.map(o => `${esc(o.nome)} ${pct(o.prob * 100, 2)}`).join(' · ')}</p>` : '';
  return `<div class="card">
    <div class="regiao-head"><h3>${esc(p.plataforma)}</h3><span>volume ${fmtUSD(p.volume)}</span></div>
    <p class="muted" style="margin:0 0 12px;font-size:13px">“${esc(p.titulo)}”</p>
    ${linhas}${outros}
  </div>`;
}
function renderApostas() {
  const el = $('#aba-apostas');
  const d = estado.previsoes;
  const seg = `<div class="seg">${[['1d', '24 h'], ['1w', '7 dias'], ['1m', '30 dias']].map(([k, n]) => `<button data-acao="periodo-prev" data-valor="${k}" class="${estado.periodoPrev === k ? 'ativo' : ''}">${n}</button>`).join('')}</div>`;
  const topo = `<div class="card seletor-turno">
      <div><h2 style="margin:0 0 4px">Mercados de previsão · Presidente 2026</h2>
        <span class="muted">Preço do contrato “Sim” (de US$ 0 a US$ 1) lido como chance implícita pelos apostadores. Não é pesquisa nem resultado. Dados de plataformas de apostas estrangeiras (Polymarket e Kalshi), exibidos só para acompanhamento. Atualiza a cada 30 s.</span></div>
      ${seg}</div>`;
  if (!d) { el.innerHTML = topo + '<div class="card vazio">Carregando mercados de previsão…</div>'; return; }
  const ok = d.plataformas.filter(p => !p.erro);
  // 2º turno: o mercado de vencedor já é Flávio × Lula, os dois que seguem na disputa
  const duelo = ok.length ? `<div class="card">
      <h2>2º turno · 25 de outubro · Flávio Bolsonaro × Lula</h2>
      ${ok.map(p => {
        const [f, l] = p.candidatos;
        const soma = (f.prob || 0) + (l.prob || 0) || 1;
        return `<div class="duelo-linha"><span class="plat">${esc(p.plataforma)}</span>
          <div class="split"><span style="width:${((f.prob || 0) / soma) * 100}%;background:${COR_CAND.flavio}">${esc(f.nome)} ${pct((f.prob || 0) * 100, 1)}</span><span style="width:${((l.prob || 0) / soma) * 100}%;background:${COR_CAND.lula}">${esc(l.nome)} ${pct((l.prob || 0) * 100, 1)}</span></div></div>`;
      }).join('')}
      <p class="nota">Como só Flávio Bolsonaro e Lula seguem na disputa, o mercado “quem vence a eleição” das duas plataformas equivale ao 2º turno. A barra mostra a divisão entre os dois.</p>
      <h2 style="margin-top:18px">Evolução da chance implícita</h2>
      <div class="legenda esquerda">${ok.flatMap(p => p.candidatos.map(c => `<span><i style="background:${COR_CAND[c.chave]}${p.plataforma === 'Kalshi' ? ';opacity:.55' : ''}"></i>${esc(c.nome)} · ${esc(p.plataforma)}${p.plataforma === 'Kalshi' ? ' (tracejado)' : ''}</span>`)).join('')}</div>
      <div class="grafico-wrap">${graficoLinha({
        series: ok.flatMap(p => p.candidatos.map(c => ({
          nome: `${c.nome} · ${p.plataforma}`, cor: COR_CAND[c.chave], tracejado: p.plataforma === 'Kalshi',
          pontos: c.historico, rotulo: c.historico.length ? `${c.nome.split(' ')[0]} ${p.plataforma[0]}` : '',
        }))),
        formatoY: v => pct(v * 100, 0), formatoX: t => fmtHora(t, d.periodo !== '1d'),
        linhasRef: [{ tempo: Date.parse('2026-10-04T17:00:00-03:00'), rotulo: '1º turno' }], dominioY: [0, 1], altura: 300,
      })}</div>
    </div>` : '';
  el.innerHTML = topo + `
    <h2 style="margin:6px 0 0">Quem vence a eleição presidencial de 2026</h2>
    <div class="mercado-grid">${d.plataformas.map(cardPlataforma).join('')}</div>
    ${duelo}
    <p class="nota" style="text-align:center">Consultado às ${esc(fmtHora(Date.parse(d.consultadoEm), true))} (horário de Brasília). Nesta rede, polymarket.com e kalshi.com são resolvidos por DNS público (Cloudflare), com autorização do responsável pelo painel.</p>`;
}

// ---------- registro e atualização ----------
ABAS_EXTRA.mercado = {
  carregar: async () => { const r = await fetch('/api/mercado?range=' + estado.rangeMercado); if (r.ok) estado.mercado = await r.json(); },
  render: renderMercado,
};
ABAS_EXTRA.apostas = {
  carregar: async () => { const r = await fetch('/api/previsoes?periodo=' + estado.periodoPrev); if (r.ok) estado.previsoes = await r.json(); },
  render: renderApostas,
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-acao="range-mercado"], [data-acao="periodo-prev"]');
  if (!t) return;
  if (t.dataset.acao === 'range-mercado') { estado.rangeMercado = t.dataset.valor; estado.mercado = null; }
  else { estado.periodoPrev = t.dataset.valor; estado.previsoes = null; }
  ABAS_EXTRA[estado.aba].render();
  atualizar();
});
// cotações e apostas mudam o tempo todo: consulta a cada 30 s enquanto a aba estiver aberta
setInterval(() => { if (estado.aba === 'mercado' || estado.aba === 'apostas') atualizar(); }, 30_000);
