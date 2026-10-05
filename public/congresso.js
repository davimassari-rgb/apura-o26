// Aba "Congresso 2027": hemiciclos do Senado (81) e da Câmara (513) após as eleições.
// Depende de app.js (estado, $, fmt, pct, esc, NOMES_UF, ABAS_EXTRA, fotoUrl, avatar)
// e de cargos.js (corPartido). A classificação esquerda/centro/direita é editorial (data/espectro.json).

const GRUPOS = [
  { chave: 'esquerda', nome: 'Esquerda', var: '--esp-esq' },
  { chave: 'centro', nome: 'Centro', var: '--esp-cen' },
  { chave: 'direita', nome: 'Direita', var: '--esp-dir' },
  { chave: 'outros', nome: 'Não classificado', var: '--esp-out' },
  { chave: 'indefinido', nome: 'Vaga indefinida', var: '--esp-out' },
];
const ROTULO_STATUS = {
  eleito: 'Eleito em 2026 (oficial TSE)', garantido: 'Eleito em 2026 (matematicamente)', projetado: 'Projeção (apuração em andamento)',
  mandato: 'Mandato até 2031 (eleito em 2022)', suplente: 'Suplente assume (mandato até 2031)', 'suplente-mat': 'Suplente deve assumir (mandato até 2031)',
  incerto: 'Mandato até 2031 · cadeira incerta', indefinido: 'Vaga ainda indefinida',
};
const VAZADO = new Set(['projetado', 'indefinido', 'incerto']);
Object.assign(estado, { congresso: null, corCongresso: 'espectro' });

// ---------- geometria do hemiciclo ----------
// Distribui N cadeiras em L fileiras concêntricas, proporcionalmente ao comprimento de cada arco,
// e devolve as posições ordenadas da esquerda para a direita (ângulo de 180° a 0°).
function posicoesHemiciclo(N, L, R, r0) {
  const raios = Array.from({ length: L }, (_, i) => r0 + (R - r0) * (L === 1 ? 1 : i / (L - 1)));
  const soma = raios.reduce((a, b) => a + b, 0);
  const porFila = raios.map(r => Math.round((N * r) / soma));
  let dif = N - porFila.reduce((a, b) => a + b, 0);
  for (let i = L - 1; dif !== 0; i = (i - 1 + L) % L) { porFila[i] += Math.sign(dif); dif -= Math.sign(dif); }
  const pos = [];
  raios.forEach((r, i) => {
    const n = porFila[i];
    for (let j = 0; j < n; j++) {
      const a = Math.PI * (1 - (n === 1 ? 0.5 : j / (n - 1)));
      pos.push({ x: r * Math.cos(a), y: -r * Math.sin(a), a, r });
    }
  });
  // esquerda -> direita; no mesmo ângulo, de fora para dentro (fatias radiais)
  // raio do ponto: 42% do menor espaçamento (entre fileiras ou entre vizinhos na mesma fileira)
  const entreFilas = L > 1 ? (R - r0) / (L - 1) : R;
  const entreVizinhos = Math.min(...raios.map((r, i) => (porFila[i] > 1 ? (Math.PI * r) / (porFila[i] - 1) : Infinity)));
  pos.raioPonto = Math.min(11, 0.42 * Math.min(entreFilas, entreVizinhos));
  const ordenadas = pos.sort((p, q) => q.a - p.a || q.r - p.r);
  ordenadas.raioPonto = pos.raioPonto;
  return ordenadas;
}

function ordenarCadeiras(cadeiras) {
  const ordemG = Object.fromEntries(GRUPOS.map((g, i) => [g.chave, i]));
  const tamPartido = {};
  for (const c of cadeiras) tamPartido[c.partido] = (tamPartido[c.partido] || 0) + 1;
  const ordemS = { mandato: 0, suplente: 0, 'suplente-mat': 0, eleito: 1, garantido: 1, incerto: 2, projetado: 2, indefinido: 3 };
  // agrupa por espectro; dentro dele, partidos maiores no centro do arco seriam mais complexos —
  // aqui: esquerda com os maiores primeiro, direita com os maiores por último (efeito "gradiente")
  return cadeiras.slice().sort((a, b) => {
    const g = ordemG[a.espectro] - ordemG[b.espectro];
    if (g) return g;
    const sinal = a.espectro === 'direita' ? 1 : -1;
    const t = (tamPartido[a.partido] - tamPartido[b.partido]) * sinal;
    if (t) return t;
    if (a.partido !== b.partido) return a.partido.localeCompare(b.partido);
    return ordemS[a.status] - ordemS[b.status];
  });
}

function corCadeira(c) {
  if (c.status === 'indefinido') return 'var(--esp-out)';
  if (estado.corCongresso === 'partido') return corPartido(c.partido);
  return `var(${GRUPOS.find(g => g.chave === c.espectro)?.var || '--esp-out'})`;
}

function hemiciclo(casa, d, rotuloCentro) {
  const N = d.cadeiras.length;
  const L = N <= 100 ? 4 : 12;
  const W = 640, R = 290, r0 = N <= 100 ? 150 : 105;
  const pos = posicoesHemiciclo(N, L, R, r0);
  const raioPonto = pos.raioPonto;
  const borda = Math.max(1.6, raioPonto * 0.28);
  const cad = ordenarCadeiras(d.cadeiras);
  const cx = W / 2, cy = R + 20;
  let svg = '';
  cad.forEach((c, i) => {
    const p = pos[i];
    const cor = corCadeira(c);
    const tip = esc(`<b>${esc(c.nome)}</b>${c.partido ? ` · ${esc(c.partido)}` : ''} · ${NOMES_UF[c.uf] || ''}<br>${ROTULO_STATUS[c.status]}${c.nota ? `<br><span class="tip-nota">${esc(c.nota)}</span>` : ''}`);
    const vazado = VAZADO.has(c.status);
    svg += `<circle cx="${(cx + p.x).toFixed(1)}" cy="${(cy + p.y).toFixed(1)}" r="${(vazado ? raioPonto - borda / 2 : raioPonto).toFixed(2)}"
      fill="${vazado ? 'var(--card)' : cor}" stroke="${cor}" stroke-width="${vazado ? borda.toFixed(2) : 0}" class="cadeira" data-tip="${tip}"/>`;
  });
  svg += `<text x="${cx}" y="${cy - 22}" text-anchor="middle" class="hemi-num">${N}</text>
    <text x="${cx}" y="${cy + 6}" text-anchor="middle" class="hemi-rot">${rotuloCentro}</text>`;
  return `<svg viewBox="0 0 ${W} ${cy + 24}" class="hemiciclo" role="img" aria-label="Composição do ${casa}">${svg}</svg>`;
}

function cartoesEspectro(d) {
  const grupos = GRUPOS.filter(g => g.chave !== 'indefinido' && (g.chave !== 'outros' || d.cadeiras.some(c => c.espectro === 'outros')));
  return `<div class="esp-cards">${grupos.map(g => {
    const cs = d.cadeiras.filter(c => c.espectro === g.chave);
    const porPartido = {};
    for (const c of cs) porPartido[c.partido] = (porPartido[c.partido] || 0) + 1;
    const lista = Object.entries(porPartido).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${esc(p)} ${n}`).join(' · ');
    return `<div class="esp-card" style="--c:var(${g.var})">
      <div class="esp-barra"></div><h3>${g.nome}</h3><b class="esp-num">${cs.length}</b>
      <div class="esp-pct">${pct((cs.length / d.cadeiras.length) * 100, 1)} das cadeiras</div>
      <div class="esp-partidos">${lista || '—'}</div>
    </div>`;
  }).join('')}</div>`;
}

function barrasPartidos(d) {
  const porPartido = {};
  for (const c of d.cadeiras) if (c.partido) porPartido[c.partido] = (porPartido[c.partido] || 0) + 1;
  const max = Math.max(...Object.values(porPartido));
  return `<div class="barras-partido">${Object.entries(porPartido).sort((a, b) => b[1] - a[1]).map(([p, n]) => `
    <div class="bp-linha"><span class="bp-nome">${esc(p)}</span>
      <span class="bp-trilho"><span style="width:${(n / max) * 100}%;background:${corPartido(p)}"></span></span>
      <b>${n}</b></div>`).join('')}</div>`;
}

function mudancasSenado(d) {
  const ms = d.cadeiras.filter(c => c.origem === '2022' && (c.status !== 'mandato' || /em 2022 era/.test(c.nota || '')));
  if (!ms.length) return '';
  const icone = { suplente: '↺', 'suplente-mat': '↺', incerto: '?', mandato: '•' };
  return `<details class="detalhe-partidos" open><summary>Mudanças entre os 27 senadores com mandato até 2031 (${ms.length})</summary>
    <ul class="mudancas">${ms.map(c => `<li><span class="mud-ic mud-${c.status}">${icone[c.status] || '•'}</span>
      <div><b>${esc(NOMES_UF[c.uf])}</b> · ${c.status.startsWith('suplente') ? `sai <b>${esc(c.titular2022)}</b>, entra <b>${esc(c.nome)}</b> (${esc(c.partido)})` : `<b>${esc(c.nome)}</b> (${esc(c.partido)})`}
      <br><span class="muted">${esc(c.nota || '')}</span></div></li>`).join('')}</ul></details>`;
}

function revisaoCamara(d) {
  const r = d.revisao;
  if (!r) return '';
  const nOf = r.conferidos.reduce((t, x) => t + x.oficiais, 0);
  const nIg = r.conferidos.reduce((t, x) => t + x.iguais, 0);
  const div = r.conferidos.filter(x => x.divergencias.length);
  const sig = uf => esc(NOMES_UF[uf]);
  const itens = [];
  itens.push(`<li><span class="mud-ic mud-suplente">✓</span><div><b>Resultado oficial em ${r.conferidos.length} estados (${nOf} cadeiras).</b>
    <br><span class="muted">Conferência da projeção do painel contra a lista oficial do TSE nesses estados: <b>${nIg} de ${nOf}</b> iguais${div.length ? `. Divergências: ${div.map(x => `${sig(x.uf)}: ${esc(x.divergencias.join(', '))}`).join('; ')}` : ''}.</span></div></li>`);
  if (r.projetados.length) {
    const nP = r.projetados.reduce((t, x) => t + x.vagas, 0);
    itens.push(`<li><span class="mud-ic mud-incerto">?</span><div><b>Ainda em projeção: ${r.projetados.length} estados (${nP} cadeiras).</b>
      <br><span class="muted">${r.projetados.sort((a, b) => b.vagas - a.vagas).map(x => `${sig(x.uf)} (${x.vagas}, ${pct(x.pctSecoes, 1)} apurado)`).join(' · ')}. Viram oficiais quando o TSE totalizar cada estado.</span></div></li>`);
  }
  if (r.parciais.length) itens.push(`<li><span class="mud-ic mud-incerto">!</span><div><b>Resultado oficial parcial</b><br><span class="muted">${r.parciais.map(x => `${sig(x.uf)}: ${x.oficiais} de ${x.vagas}`).join(' · ')}</span></div></li>`);
  if (r.foraDaVaga.length) itens.push(`<li><span class="mud-ic">⚖</span><div><b>Fora da conta por votos anulados (sub judice ou indeferidos): ${r.foraDaVaga.length}</b>
    <br><span class="muted">Esses candidatos tiveram votos suficientes para disputar vaga, mas os votos estão anulados e não contam; por isso não ocupam cadeira, nem na projeção. Se a Justiça Eleitoral validar a candidatura depois, o resultado é recalculado pelo TSE.</span>
    <br><span class="muted">${r.foraDaVaga.sort((a, b) => b.votos - a.votos).map(x => `${esc(x.nome)} (${esc(x.partido)}-${x.uf.toUpperCase()}, ${fmt(x.votos)} votos)`).join(' · ')}</span></div></li>`);
  return `<details class="detalhe-partidos" open><summary>Revisão das 513 cadeiras</summary><ul class="mudancas">${itens.join('')}</ul></details>`;
}

function blocoCasa(casa, d, extra) {
  const st = s => d.cadeiras.filter(c => c.status === s).length;
  const confirmados = st('eleito') + st('garantido') + st('mandato') + st('suplente') + st('suplente-mat');
  const projetados = st('projetado') + st('indefinido') + st('incerto');
  return `<div class="card casa">
    <div class="casa-topo">
      <h2 class="casa-titulo">${casa === 'senado' ? 'Senado' : 'Câmara dos Deputados'} em 2027</h2>
      <p class="casa-sub">${d.total} cadeiras · maioria: ${d.maioria} · ${extra}</p>
    </div>
    ${hemiciclo(casa === 'senado' ? 'Senado' : 'Câmara', d, casa === 'senado' ? 'senadores' : 'deputados')}
    <div class="legenda" style="margin-top:4px">
      <span><i class="pt-cheio"></i>Confirmado: ${confirmados}</span>
      <span><i class="pt-vazado"></i>Projeção: ${projetados}</span>
      <span>Apuração: ${pct(d.pctSecoes, 1)} das seções</span>
    </div>
    ${cartoesEspectro(d)}
    ${casa === 'senado' ? mudancasSenado(d) : revisaoCamara(d)}
    <details class="detalhe-partidos"><summary>Cadeiras por partido</summary>${barrasPartidos(d)}</details>
  </div>`;
}

function renderCongresso() {
  const el = $('#aba-congresso');
  const d = estado.congresso;
  if (estado.fonte === 'demo') { el.innerHTML = '<div class="card vazio">O modo demonstração não cobre o Congresso. Volte para “Oficial TSE”.</div>'; return; }
  if (!d) { el.innerHTML = '<div class="card vazio">Carregando composição do Congresso…</div>'; return; }
  const sen2026 = d.senado.cadeiras.filter(c => c.origem === '2026').length;
  // o redesenho a cada boletim não deve abrir/fechar as seções que a pessoa mexeu
  const abertos = [...el.querySelectorAll('details')].map(x => x.open);
  el.innerHTML = `
    <div class="card seletor-turno">
      <div><h2 style="margin:0 0 4px">Congresso em 2027: como fica após as eleições</h2>
        <span class="muted">Passe o mouse em cada cadeira para ver o parlamentar. Ponto cheio = confirmado. Ponto vazado = projeção enquanto a apuração não termina.</span></div>
      <div class="seg"><button data-acao="cor-congresso" data-valor="espectro" class="${estado.corCongresso === 'espectro' ? 'ativo' : ''}">Cores por espectro</button><button data-acao="cor-congresso" data-valor="partido" class="${estado.corCongresso === 'partido' ? 'ativo' : ''}">Cores por partido</button></div>
    </div>
    <div class="casas">
      ${blocoCasa('senado', d.senado, `${sen2026} eleitos em 2026 + 27 com mandato até 2031`)}
      ${blocoCasa('camara', d.camara, 'todas as cadeiras renovadas em 2026')}
    </div>
    <div class="card nota">
      <b>Fontes e critérios.</b> Os eleitos de 2026 vêm dos arquivos de resultado do TSE (Senado: os 2 mais votados de cada UF; Câmara: eleitos oficiais ou, até o TSE totalizar o estado, a projeção pelas vagas que o TSE calcula para cada partido ou federação, preenchidas pelos mais votados com votos válidos e pelo menos 10% do quociente eleitoral. Candidaturas com votos anulados (sub judice ou indeferidas) não ocupam cadeira. Como cada candidato só pode disputar um cargo por eleição, nenhum deputado eleito em 2026 deixa a vaga por ter vencido outra disputa.)
      Os 27 senadores com mandato até 2031 (e seus suplentes) vêm de ${esc(d.senado.fonte2031 || 'TSE')}. Cada um é cruzado pelo nome completo com todas as candidaturas de 2026 (presidente, vice, governador, vice-governador e deputados):
      eleito em 2026 → assume o 1º suplente; no 2º turno → cadeira incerta (ponto vazado); candidato derrotado → segue no Senado com o partido da candidatura de 2026.
      Quem não concorreu em 2026 aparece com o partido de 2022. Mudanças fora dos arquivos de eleição (licenças, renúncias, nomeações) ficam em <code>data/senado-ajustes.json</code>.
      <b>A classificação esquerda/centro/direita é editorial</b> e pode ser editada em <code>data/espectro.json</code>.
    </div>`;
  const ds = el.querySelectorAll('details');
  if (abertos.length === ds.length) ds.forEach((x, i) => (x.open = abertos[i]));
}

ABAS_EXTRA.congresso = {
  carregar: async () => { const r = await fetch('/api/congresso'); if (r.ok) estado.congresso = await r.json(); },
  render: renderCongresso,
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-acao="cor-congresso"]');
  if (!t) return;
  estado.corCongresso = t.dataset.valor;
  renderCongresso();
});
