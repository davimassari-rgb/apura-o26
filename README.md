# Painel de Apuração – Eleições 2026

Painel local que lê os arquivos oficiais de resultados do TSE (`resultados.tse.jus.br`) e se atualiza sozinho a cada 30 s.

## Como rodar

Precisa do Node.js 18 ou mais recente. Não há dependências para instalar.

```bash
node server.js
```

Depois abra http://localhost:3000. No Windows, também dá para dar dois cliques em `iniciar.bat`.

## Abas

- **Brasil**: Presidente com total nacional, % de seções totalizadas, mapa de quem lidera em cada estado e números de comparecimento.
- **Regiões**: Norte, Nordeste, Centro-Oeste, Sudeste e Sul. Tem uma tabela comparativa e, ao escolher uma região, o detalhe estado por estado.
- **Governadores** e **Senadores**: as 27 UFs lado a lado, com filtro por região e um resumo por partido. Em 2026 são 2 vagas de senador por estado. Clique em um estado para ver todos os candidatos.
- **Dep. Federais** e **Dep. Estaduais**: a bancada projetada da Câmara (513) ou a soma das Assembleias (1.059, incluindo os 24 distritais do DF), ou o detalhe de uma UF com vagas, quociente eleitoral, gráfico de cadeiras e lista de candidatos com busca.
- **Congresso 2027**: hemiciclos do Senado (81 cadeiras: 54 eleitos em 2026 e 27 com mandato até 2031) e da Câmara (513), com cartões Esquerda/Centro/Direita, cores por espectro ou por partido e o nome de cada parlamentar ao passar o mouse. Ponto cheio = confirmado; ponto vazado = projeção.
- **2022 × 2026**: Presidente. Compara o 1º turno de 2026 (Flávio e Lula) com o **1º ou o 2º turno de 2022** (Jair e Lula), escolhidos por um seletor no topo da aba. Tem gráfico por Brasil e região, a curva da apuração, a diferença Bolsonaro − Lula por estado e uma tabela completa.
- **Estados**: Presidente, Governador ou Senador em qualquer UF.
- **Mercado**: Ibovespa e dólar comercial com cotação, variação, gráfico de 1 dia, 5 dias ou 1 mês, e a **reação ao 1º turno**: a variação desde o último pregão antes de 04/10/2026. Atualiza a cada 30 s.
- **Apostas**: mercados de previsão da Polymarket e da Kalshi para o vencedor da eleição presidencial e para o 2º turno (Flávio Bolsonaro × Lula), com gráfico de evolução das duas plataformas. Atualiza a cada 30 s.

## Fonte dos dados

| Item | Endereço |
|---|---|
| Configuração dos pleitos | `/oficial/comum/config/ele-c.json` |
| Presidente (eleição 6257) | `/oficial/ele2026/6257/dados/<uf>/<uf>-c0001-e006257-u.json` |
| Governador / Senador (eleição 6259) | `/oficial/ele2026/6259/dados/<uf>/<uf>-c0003 / c0005-e006259-u.json` |
| Deputados (eleição 6259) | `.../6259/dados/<uf>/<uf>-c0006` (federal), `c0007` (estadual), `c0008` (distrital, DF) |
| 2022 por UF | Portal de Dados Abertos do TSE, `votacao_partido_munzona_2022.zip` |
| Curva da apuração de 2022 | Portal de Dados Abertos do TSE, `Historico_Totalizacao_Presidente_BR_1T_2022.zip` e `..._2T_2022.zip` |
| Fotos | `/oficial/ele2026/<eleição>/fotos/<uf>/<sqcand>.jpeg` |

- **Atualização em tempo real:** o servidor monitora cada arquivo do TSE. O arquivo nacional é consultado a cada 4 s e os arquivos da aba aberta a cada 8 s. As consultas usam `ETag`, então quando nada mudou o TSE responde 304, sem dados. Quando um boletim novo sai, o servidor avisa o navegador na hora (Server-Sent Events, em `/api/eventos`), e o cabeçalho mostra o horário do boletim do TSE e há quantos segundos ele foi verificado.
- **Diagnóstico:** `/api/status` mostra, para cada arquivo monitorado, o horário do boletim, quando foi verificado, quantas consultas foram feitas e quantas voltaram 304.
- **Regiões** são a soma dos arquivos oficiais de cada UF. Os percentuais são calculados sobre os votos válidos somados.
- **Brasil** usa o arquivo nacional do TSE, que tem os mesmos números do site oficial. Só se esse arquivo faltar ou ficar mais de 5 minutos atrás dos estaduais o painel passa a mostrar a soma das UFs mais o exterior, e avisa na barra de progresso.
- **Modo Demonstração** usa dados **fictícios** e serve só para testar o visual.

### Deputados: o que é "projetado"
O TSE publica, para cada partido ou federação, quantas vagas ela teria com os votos já apurados (campo `vag`). Dentro de cada agremiação, o painel marca como "Projetado" os mais votados que cabem nessas vagas e têm pelo menos 10% do quociente eleitoral. Quando o TSE marcar os eleitos oficialmente, aparece "Eleito".

### Comparativo 2022
Os arquivos de 2022 já processados estão em `data/`. Para gerá-los de novo a partir dos CSVs oficiais:
```bash
node scripts/gerar-2022.js votacao_partido_munzona_2022_BR.csv Historico_Totalizacao_Presidente_BR_1T_2022.csv Historico_Totalizacao_Presidente_BR_2T_2022.csv
```
A curva de 2026 não existe pronta no TSE. O próprio servidor grava um ponto a cada 30 s em `data/2026-historico-br-1t.json`, mesmo sem nenhum navegador aberto.

### Selo ELEITO
O selo verde **ELEITO** aparece em qualquer candidato já eleito, por um destes três critérios, nesta ordem:
1. **Oficial do TSE:** a situação do candidato é "Eleito", "Eleito por QP" ou "Eleito por média".
2. **Definido pelo TSE:** o arquivo do estado traz `md = "e"` (matematicamente eleito), o que vale para o líder de Governador ou Presidente.
3. **Cálculo do painel (pior cenário):** supõe que todos os eleitores das seções ainda não totalizadas votem contra o candidato.
   - Governador e Presidente: o candidato é eleito se continuar com mais de 50% dos válidos. Os votos anulados sub judice também entram nessa conta, porque podem voltar a valer.
   - Senador: o candidato é eleito se menos adversários do que o número de vagas ainda puderem alcançá-lo.

Presidente só recebe o selo pelo total nacional, nunca por estado. Deputados só recebem o selo oficial do TSE: a conta proporcional (quociente e sobras) pode mudar até o fim.
Também há os selos **2º TURNO** (oficial ou `md = "s"`) e **SUB JUDICE**. Ao passar o mouse sobre qualquer selo, aparece o critério usado.

### Fotos dos candidatos
- **2026:** vêm do TSE (`/oficial/ele2026/<eleição>/fotos/<uf>/<sqcand>.jpeg`) pelo proxy local `/foto/<eleição>/<uf>/<sqcand>.jpeg`. Cada foto é baixada uma única vez e guardada em `data/fotos/`. Sem foto, aparecem as iniciais do candidato.
- **2022 (Jair e Lula, na aba 2022 × 2026):** vêm do pacote oficial "Fotos de candidatos 2022 – BR" do Portal de Dados Abertos do TSE (`foto_cand2022_BR_div.zip`) e estão em `public/fotos/2022/`. Os números sequenciais de cada um (`280001607829` = LULA e `280001618036` = JAIR BOLSONARO) foram conferidos no cadastro oficial `consulta_cand_2022_BR.csv`.

### Congresso 2027
- **Senado, 54 eleitos em 2026:** os 2 mais votados de cada UF nos arquivos do TSE.
- **Senado, 27 com mandato até 2031:** vêm de `data/senado-mandato-2031.json`, gerado a partir do cadastro oficial do TSE:
  ```bash
  node scripts/gerar-senado-2031.js <pasta_com_consulta_cand_2022_UF.csv>
  ```
  O arquivo inclui os 1º e 2º suplentes. Cada senador é cruzado pelo **nome completo** (sem acentos e espaços, na mesma UF) com todas as candidaturas de 2026: presidente, vice, governador, vice-governador e deputados.
  - Se foi **eleito** em 2026, assume o 1º suplente. Se o 1º suplente também tiver sido eleito para outro cargo, assume o 2º.
  - Se está no **2º turno**, a cadeira fica incerta (ponto vazado).
  - Se foi **candidato e perdeu**, segue no Senado com o partido da candidatura de 2026.
  - Se **não concorreu**, aparece com o partido de 2022.

  O nome de urna sozinho não é usado no cruzamento, porque gera falsos positivos. Exemplo: há um "CLEITINHO" deputado estadual em MG que é outra pessoa.
  Mudanças que não aparecem nos arquivos de eleição, como renúncias e nomeações, ficam em `data/senado-ajustes.json`. Hoje há uma: Flávio Dino, que foi para o STF em 2024, substituído por Ana Paula Lobato.
- **Câmara:** os eleitos oficiais do TSE. Enquanto o TSE não totaliza o estado, entra a projeção. Ela usa as vagas que o TSE calcula para cada partido ou federação (campo `vag`), preenchidas pelos mais votados com **votos válidos** e pelo menos 10% do quociente eleitoral.
  - Candidaturas com votos **anulados** (sub judice ou indeferidas) não ocupam vaga. Sem essa regra, a projeção punha Ricardo Abrão (PSDB-RJ) no lugar de Talita Galhardo, que é a eleita oficial.
  - O painel "Revisão das 513 cadeiras" confere a cada boletim a projeção contra a lista oficial nos estados já fechados (hoje 264 de 264 iguais), lista os estados ainda em projeção e mostra quem ficou fora por votos anulados.
  - Como cada candidato só disputa um cargo por eleição, nenhum deputado eleito em 2026 deixa a vaga por ter vencido outra disputa. Por isso não existe na Câmara a troca por suplente que acontece no Senado.
- **Espectro:** a classificação esquerda/centro/direita é **editorial** e fica em `data/espectro.json`. Edite as siglas de cada grupo à vontade.

### Mercado e Apostas
- **Ibovespa e dólar:** vêm do Yahoo Finance (`query1.finance.yahoo.com/v8/finance/chart`). O Ibovespa tem atraso de até 15 min; o dólar comercial (USD/BRL) é negociado 24 h. A tela é informativa e não é recomendação de investimento.
- **Polymarket:** evento "Brazil Presidential Election", pela Gamma API (preços) e pelo CLOB (`prices-history`, histórico).
- **Kalshi:** evento `KXBRPRES-26`, pela Trade API v2 (mercados e `candlesticks`).
- **2º turno:** como só Flávio Bolsonaro e Lula seguem na disputa, o mercado "quem vence a eleição" das duas plataformas equivale ao 2º turno de 25/10.
- **DNS público:** `polymarket.com` e `kalshi.com` são bloqueados pelo DNS da rede onde o painel foi montado. Com autorização do responsável, **só esses dois domínios** são resolvidos pelo DNS público (Cloudflare 1.1.1.1 / Google 8.8.8.8) no servidor local; todo o resto usa o DNS do sistema. Na Vercel, fora do Brasil, o desvio não é usado. Para desligar, remova o `lookup` de `obterJSON` em `server.js`.
