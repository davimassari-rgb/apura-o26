// Gera os arquivos de 2022 (Presidente) usados na aba "2022 × 2026", a partir dos arquivos
// oficiais do Portal de Dados Abertos do TSE (dataset "resultados-2022"):
//   - votacao_partido_munzona_2022.zip  -> votacao_partido_munzona_2022_BR.csv (Presidente, 1º e 2º turnos)
//   - Historico_Totalizacao_Presidente_BR_1T_2022.zip -> Historico_Totalizacao_Presidente_BR_1T_2022.csv
//   - Historico_Totalizacao_Presidente_BR_2T_2022.zip -> Historico_Totalizacao_Presidente_BR_2T_2022.csv
// Saída: data/2022-presidente-{1,2}t.json e data/2022-historico-br-{1,2}t.json
// Uso: node scripts/gerar-2022.js <csv_partido_BR> <csv_historico_1T> [csv_historico_2T]
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const [csvPartido, csvHist1, csvHist2] = process.argv.slice(2);
if (!csvPartido || !csvHist1) {
  console.error('Uso: node scripts/gerar-2022.js <votacao_partido_munzona_2022_BR.csv> <Historico_..._1T_2022.csv> [Historico_..._2T_2022.csv]');
  process.exit(1);
}
const OUT = path.join(__dirname, '..', 'data');
fs.mkdirSync(OUT, { recursive: true });

const linhas = file => readline.createInterface({ input: fs.createReadStream(file, { encoding: 'latin1' }), crlfDelay: Infinity });
const campos = l => l.split(';').map(s => s.trim().replace(/^"|"$/g, ''));
const num = s => Number(String(s).trim().replace(',', '.')) || 0;

const CANDIDATOS_2022 = { 13: 'LULA', 22: 'JAIR BOLSONARO', 12: 'CIRO GOMES', 15: 'SIMONE TEBET', 44: 'SORAYA THRONICKE', 30: "FELIPE D'AVILA", 14: 'PADRE KELMON', 16: 'VERA', 21: 'SOFIA MANZANO', 27: 'CONSTITUINTE EYMAEL', 80: 'LÉO PÉRICLES' };

// votos nominais válidos por UF e partido, separados por turno
async function porUF() {
  let cab;
  const turnos = { 1: {}, 2: {} };
  for await (const l of linhas(csvPartido)) {
    const c = campos(l);
    if (!cab) { cab = Object.fromEntries(c.map((n, i) => [n, i])); continue; }
    if (c[cab.CD_CARGO] !== '1') continue;
    const t = turnos[c[cab.NR_TURNO]];
    if (!t) continue;
    const uf = c[cab.SG_UF].toLowerCase();
    const nr = c[cab.NR_PARTIDO];
    const v = num(c[cab.QT_VOTOS_NOMINAIS_VALIDOS]);
    const u = (t[uf] ||= { validos: 0, votos: {} });
    u.validos += v;
    u.votos[nr] = (u.votos[nr] || 0) + v;
  }
  return turnos;
}

async function historico(arquivo) {
  let cab;
  const pts = [];
  for await (const l of linhas(arquivo)) {
    const c = campos(l);
    if (!cab) { cab = Object.fromEntries(c.map((n, i) => [n, i])); continue; }
    if (c.length < 5) continue;
    if (cab.SG_UE_UF !== undefined && c[cab.SG_UE_UF] !== 'BR') continue;
    pts.push({
      hora: c[cab.DT_TOTALIZACAO],
      pctSecoes: num(c[cab.PE_SECOES_TOT_ACUMULADO]) * 100,
      lula: num(c[cab.LULA_PE_VOTOS_TOT_ACUMULADO]) * 100,
      jair: num(c[cab.JAIR_BOLSONARO_PE_VOTOS_TOT_ACUMULADO]) * 100,
    });
  }
  // reduz para ~1 ponto a cada 0,5 p.p. de seções apuradas
  const out = [];
  let ultimo = -1;
  for (const p of pts) {
    if (p.pctSecoes <= 0) continue;
    if (p.pctSecoes - ultimo >= 0.5 || p === pts[pts.length - 1]) { out.push(p); ultimo = p.pctSecoes; }
  }
  return out;
}

(async () => {
  const turnos = await porUF();
  for (const t of [1, 2]) {
    const ufs = turnos[t];
    if (!Object.keys(ufs).length) continue;
    fs.writeFileSync(path.join(OUT, `2022-presidente-${t}t.json`), JSON.stringify({
      fonte: `TSE – Portal de Dados Abertos, votacao_partido_munzona_2022 (Presidente, ${t}º turno, votos nominais válidos)`,
      turno: t, candidatos: CANDIDATOS_2022, ufs,
    }));
    const br = Object.values(ufs).reduce((a, u) => ({ validos: a.validos + u.validos, lula: a.lula + (u.votos[13] || 0), jair: a.jair + (u.votos[22] || 0) }), { validos: 0, lula: 0, jair: 0 });
    console.log(`${t}º turno | UFs: ${Object.keys(ufs).length} | Lula ${br.lula} (${(br.lula / br.validos * 100).toFixed(2)}%) | Jair ${br.jair} (${(br.jair / br.validos * 100).toFixed(2)}%)`);
  }
  for (const [t, arq] of [[1, csvHist1], [2, csvHist2]]) {
    if (!arq) continue;
    const pontos = await historico(arq);
    fs.writeFileSync(path.join(OUT, `2022-historico-br-${t}t.json`), JSON.stringify({
      fonte: `TSE – Portal de Dados Abertos, Historico_Totalizacao_Presidente_BR_${t}T_2022`, turno: t, pontos,
    }));
    console.log(`Histórico ${t}º turno: ${pontos.length} pontos, último`, pontos[pontos.length - 1]);
  }
})();
