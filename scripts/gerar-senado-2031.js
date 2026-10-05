// Gera data/senado-mandato-2031.json: os 27 senadores eleitos em 2022 (mandato até 31/01/2031),
// que continuam no Senado em 2027 ao lado dos 54 eleitos em 2026, com seus 1º e 2º suplentes.
// Fonte: TSE – Portal de Dados Abertos, consulta_cand_2022.zip (consulta_cand_2022_<UF>.csv)
// Uso: node scripts/gerar-senado-2031.js <pasta_com_os_csv_consulta_cand_2022>
//
// O partido registrado é o da ELEIÇÃO de 2022. O servidor atualiza o partido quando o senador
// é candidato em 2026 (registro oficial de 2026) e troca o titular pelo suplente quando ele é
// eleito para outro cargo. Casos fora dos arquivos do TSE vão em data/senado-ajustes.json.
const fs = require('fs');
const path = require('path');

const pasta = process.argv[2];
if (!pasta) { console.error('Uso: node scripts/gerar-senado-2031.js <pasta_consulta_cand_2022>'); process.exit(1); }

const titulares = [];
const suplentes = {}; // "<uf>-<numero>" -> [1º, 2º]
for (const arq of fs.readdirSync(pasta).filter(f => /^consulta_cand_2022_[A-Z]{2}\.csv$/.test(f))) {
  const linhas = fs.readFileSync(path.join(pasta, arq), 'latin1').split(/\r?\n/);
  const cab = Object.fromEntries(linhas[0].split(';').map((n, i) => [n.replace(/"/g, ''), i]));
  for (const l of linhas.slice(1)) {
    if (!l) continue;
    const c = l.split(';').map(s => s.replace(/^"|"$/g, ''));
    if (c[cab.DS_SIT_TOT_TURNO] !== 'ELEITO') continue;
    const cargo = c[cab.DS_CARGO];
    const p = {
      uf: c[cab.SG_UF].toLowerCase(),
      numero: c[cab.NR_CANDIDATO],
      nome: c[cab.NM_URNA_CANDIDATO],
      nomeCompleto: c[cab.NM_CANDIDATO],
      partido: c[cab.SG_PARTIDO],
      sqcand: c[cab.SQ_CANDIDATO],
    };
    if (cargo === 'SENADOR') titulares.push(p);
    else if (/SUPLENTE/.test(cargo)) {
      const k = `${p.uf}-${p.numero}`;
      (suplentes[k] ||= [])[cargo.startsWith('1') ? 0 : 1] = p;
    }
  }
}
const senadores = titulares
  .map(t => ({ ...t, suplentes: (suplentes[`${t.uf}-${t.numero}`] || []).filter(Boolean) }))
  .sort((a, b) => a.uf.localeCompare(b.uf));
const out = path.join(__dirname, '..', 'data', 'senado-mandato-2031.json');
fs.writeFileSync(out, JSON.stringify({
  fonte: 'TSE – Portal de Dados Abertos, consulta_cand_2022 (senadores eleitos em 2022 e suplentes; partido da eleição)',
  senadores,
}, null, 1));
console.log(senadores.length, 'senadores;', senadores.filter(s => s.suplentes.length === 2).length, 'com os 2 suplentes');
