/* data-raw/*.csv  →  public/data/*.json 변환기
 *
 * 실행:  npm run data
 *
 * 왜 미리 변환하나?
 *  - 브라우저에서 CSV 를 파싱하면 30명분 파싱 비용이 각자 발생합니다.
 *  - 원본 CSV 에는 수업에 안 쓰는 열이 많습니다. 미리 덜어내면 전송량이 줄어듭니다.
 *  - 원본(data-raw/)은 그대로 두므로 언제든 다시 만들 수 있습니다.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data');

/* ── 아주 작은 CSV 파서 ────────────────────────────────────
   따옴표로 감싼 값과 값 안의 쉼표까지만 처리합니다.
   두 원본 파일이 이 범위를 벗어나지 않는 것을 확인했습니다. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }

    if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.length === header.length && r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (n, d = 2) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

/* ── 1. 다양성 곡선 ────────────────────────────────────────
   sampled_in_bin = 그 구간에서 실제로 화석이 확인된 속(genus)의 수.
   원본 확인: X_Ft + X_bL + X_FL + X_bt = sampled_in_bin (합이 맞습니다)   */
function buildDiversity() {
  const raw = parseCSV(readFileSync(join(ROOT, 'data-raw', 'pbdb_diversity.csv'), 'utf8'));

  const bins = raw
    .map((r) => {
      const maxMa = num(r.max_ma);
      const minMa = num(r.min_ma);
      if (maxMa === null || minMa === null) return null;
      return {
        id: String(r.interval_no),          // marks 문서의 binId 로 그대로 씁니다
        name: r.interval_name,              // 교사용. 학생 화면에는 기(紀) 명칭을 띄우지 않습니다
        maxMa: round(maxMa, 3),
        minMa: round(minMa, 3),
        midMa: round((maxMa + minMa) / 2, 3),
        value: num(r.sampled_in_bin),
        nOccs: num(r.n_occs),
      };
    })
    .filter((b) => b && b.value !== null)
    .sort((a, b) => b.midMa - a.midMa);     // 오래된 것 → 최근 순

  return {
    _source: 'Paleobiology Database (paleobiodb.org), CC BY 4.0',
    _generatedBy: 'scripts/build-data.mjs — 원본은 data-raw/pbdb_diversity.csv',
    metric: 'sampled_in_bin',
    metricLabel: '화석으로 확인된 속(genus)의 수',
    ageRangeMa: [bins[0].midMa, bins[bins.length - 1].midMa],
    bins,
  };
}

/* ── 2. 기온 · 이산화 탄소 ────────────────────────────────
   PhanDA 는 확률 분포로 복원한 값이라 백분위수로 제공됩니다.
   p50(중앙값)을 선으로, p16~p84(약 68% 구간)를 띠로 그립니다.
   "과거 기온은 하나의 정확한 값이 아니라 범위로 추정된다"는 것을
   학생이 눈으로 보게 하는 것이 이 띠의 목적입니다.                */
function buildClimate() {
  const raw = parseCSV(
    readFileSync(join(ROOT, 'data-raw', 'PhanDA_GMSTandCO2_percentiles.csv'), 'utf8')
  );

  const points = raw
    .map((r) => {
      const ma = num(r.AverageAge);
      if (ma === null) return null;
      return {
        ma: round(ma, 3),
        stage: r.Stage,
        period: r.Period,
        gmst: round(num(r.GMST_50), 2),
        gmstLo: round(num(r.GMST_16), 2),
        gmstHi: round(num(r.GMST_84), 2),
        co2: round(num(r.CO2_50), 1),
        co2Lo: round(num(r.CO2_16), 1),
        co2Hi: round(num(r.CO2_84), 1),
      };
    })
    .filter((p) => p && p.gmst !== null && p.co2 !== null)
    .sort((a, b) => b.ma - a.ma);

  return {
    _source:
      'Judd, E. J. et al. (2024), Science 385, eadk3705 (PhanDA) — github.com/EJJudd/PhanDA',
    _generatedBy: 'scripts/build-data.mjs — 원본은 data-raw/PhanDA_GMSTandCO2_percentiles.csv',
    _note:
      '중앙값(p50)과 68% 구간(p16~p84)입니다. 과거 기온·CO2는 단일 값이 아니라 범위로 추정됩니다.',
    gmstUnit: '°C (전 지구 평균 표면온도)',
    co2Unit: 'ppm',
    ageRangeMa: [points[0].ma, points[points.length - 1].ma],
    points,
  };
}

/* ── 3. 가설 법정 데이터에서 교사용 항목 덜어내기 ──────────
   data-raw/hypotheses.json 은 교사용 원본입니다. 정답표가 들어 있습니다.
     evidenceStrength   어느 칸의 증거가 약한지 = 매트릭스의 정답
     criteriaAnswerKey  20칸 전체의 기준별 정답
     teacherNote        칸마다의 지도 요령
     _meta.pedagogy     모둠 배정 권장 순서
     rubric_서술형       서술형 채점 기준
   public/ 에 있는 파일은 브라우저가 통째로 내려받을 수 있으므로,
   학생이 주소만 알면 정답표를 열어볼 수 있습니다.
   그래서 학생용 사본을 따로 만들어 내보냅니다.

   심화 보기에 쓰이는 teacherLabel 과 ageMa 는 남깁니다 —
   교육과정 표기 규칙이 "심화 보기 안에서는 허용"으로 정하고 있습니다. */
function buildHypothesesPublic() {
  const src = JSON.parse(readFileSync(join(ROOT, 'data-raw', 'hypotheses.json'), 'utf8'));

  return {
    _note: '학생용 사본입니다. 교사용 원본은 data-raw/hypotheses.json 에 있습니다.',
    dataSources: src._meta?.dataSources ?? [],

    criteria: src.criteria.map(({ id, label, tooltip }) => ({ id, label, tooltip })),

    events: src.events.map(({ id, studentLabel, studentEra, teacherLabel, ageMa,
      marineGenusLossEstimate, distinctiveFeature }) => ({
      id, studentLabel, studentEra, teacherLabel, ageMa,
      marineGenusLossEstimate, distinctiveFeature,
    })),

    hypotheses: src.hypotheses.map(({ id, name, mechanism, evidenceType }) => ({
      id, name, mechanism, evidenceType,
    })),

    cells: src.cells.map((c) => ({
      id: c.id,
      eventId: c.eventId,
      hypothesisId: c.hypothesisId,
      // cards 의 confidence 는 교사가 원문 확인할 카드를 표시한 것이라 뺍니다.
      cards: (c.cards || []).map(({ claim, detail, sourceType }) => ({
        claim, detail, sourceType,
      })),
      rebuttalSeeds: c.rebuttalSeeds || [],
    })),
  };
}

/* ── 실행 ─────────────────────────────────────────────── */
mkdirSync(OUT_DIR, { recursive: true });

const diversity = buildDiversity();
const climate = buildClimate();
const hypotheses = buildHypothesesPublic();

writeFileSync(join(OUT_DIR, 'diversity.json'), JSON.stringify(diversity), 'utf8');
writeFileSync(join(OUT_DIR, 'climate.json'), JSON.stringify(climate), 'utf8');
writeFileSync(join(OUT_DIR, 'hypotheses.json'), JSON.stringify(hypotheses), 'utf8');

console.log(`diversity.json   구간 ${diversity.bins.length}개   ${diversity.ageRangeMa[0]} → ${diversity.ageRangeMa[1]} Ma`);
console.log(`climate.json     지점 ${climate.points.length}개   ${climate.ageRangeMa[0]} → ${climate.ageRangeMa[1]} Ma`);
console.log(`hypotheses.json  칸 ${hypotheses.cells.length}개 (정답표 제거된 학생용)`);

/* 두 데이터의 시간 범위가 다릅니다. 차트에서 이 구간을 비워 두어야 합니다. */
const gap = diversity.ageRangeMa[0] - climate.ageRangeMa[0];
if (gap > 1) {
  console.log(
    `\n주의: ${climate.ageRangeMa[0]} Ma 이전(약 ${Math.round(gap)}백만 년)에는 기온·CO2 데이터가 없습니다.\n` +
      '      차트에서 이 구간은 비워 두고 "데이터 없음"으로 표시합니다.'
  );
}
