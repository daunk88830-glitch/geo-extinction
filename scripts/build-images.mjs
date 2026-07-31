/* data-raw/eras-source.png  →  public/img/*.jpg + public/data/era-images.json
 *
 * 실행:  npm run images
 *
 * 원본은 4개 대(代)가 가로로 배열된 1536×1024 도표입니다.
 * 좌표는 눈대중이 아니라 이미지의 여백(흰 열/행)을 찾아 정한 값입니다.
 *   패널 경계   x 10-381 / 387-751 / 757-1125 / 1132-1524
 *   장면 그림   y 99-418   (머리띠가 y 96 에서 끝남)
 *   화석 사진   y 522-620  (아래 y 629-641 은 원본 글자라 자르지 않고
 *                          앱에서 진짜 텍스트로 다시 씁니다)
 *
 * 빌드마다 돌리지 않습니다. 원본 그림을 바꿨을 때만 실행하고
 * 결과물은 저장소에 커밋합니다. 배포 빌드를 느리게 만들지 않기 위해서입니다.
 */

import { Jimp } from 'jimp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data-raw', 'eras-source.png');
const IMG_DIR = join(ROOT, 'public', 'img');
const DATA_DIR = join(ROOT, 'public', 'data');

const SCENE_Y = [99, 418];    // 장면 그림 위/아래
const FOSSIL_Y = [522, 620];  // 화석 사진 위/아래

const ERAS = [
  {
    id: 'precambrian',
    panel: [10, 381],
    sceneAlt: '얕은 바다 바닥에 스트로마톨라이트가 쌓여 있고 해파리 같은 단순한 생물이 떠 있는 모습',
    fossils: [
      { x: [18, 145], label: '스트로마톨라이트' },
      { x: [151, 241], label: '남조류 화석' },
      { x: [255, 375], label: '운모편암 내 화석' },
    ],
  },
  {
    id: 'paleozoic',
    panel: [387, 751],
    sceneAlt: '물가에 양치식물 숲이 우거지고 바닷속에 삼엽충과 어류가 있는 모습',
    fossils: [
      { x: [389, 470], label: '삼엽충' },
      { x: [480, 566], label: '완족류' },
      { x: [576, 658], label: '필석류' },
      { x: [664, 750], label: '산호류' },
    ],
  },
  {
    id: 'mesozoic',
    panel: [757, 1125],
    sceneAlt: '공룡들이 숲과 물가에 있고 하늘에 익룡이 날며 멀리 화산이 연기를 내뿜는 모습',
    /* 그림 자체가 오개념을 담고 있어 그대로 문제로 쓸 수 있습니다.
       답은 eras.json 의 misconceptionNote 를 그대로 씁니다. 중복해서 적지 않습니다. */
    sceneQuestion: {
      ask: '이 그림에서 공룡이 아닌 것은?',
      hint: '넷이 보입니다. 그중 하나는 공룡이 아닙니다. 어디에 있나요?',
    },
    fossils: [
      { x: [759, 856], label: '암모나이트' },
      { x: [858, 944], label: '베렘나이트' },
      { x: [946, 1040], label: '공룡 발자국 화석' },
      { x: [1046, 1124], label: '익룡 화석' },
    ],
  },
  {
    id: 'cenozoic',
    panel: [1132, 1524],
    sceneAlt: '초원에 매머드와 코뿔소 같은 포유류가 있고 뒤로 산과 침엽수림이 보이는 모습',
    fossils: [
      { x: [1134, 1223], label: '화석 산호' },
      { x: [1233, 1319], label: '유공충' },
      { x: [1321, 1427], label: '매머드 어금니' },
      { x: [1429, 1512], label: '말 이빨 화석' },
    ],
  },
];

mkdirSync(IMG_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

const src = await Jimp.read(SRC);
console.log(`원본 ${src.width}×${src.height}`);

async function save(img, name, quality) {
  const buf = await img.getBuffer('image/jpeg', { quality });
  writeFileSync(join(IMG_DIR, name), buf);
  return buf.length;
}

const out = { _note: 'scripts/build-images.mjs 가 생성합니다. 직접 고치지 마세요.', eras: {} };
let total = 0;

for (const era of ERAS) {
  const [x0, x1] = era.panel;

  // 장면 — 배경과 카드 안 그림으로 함께 씁니다.
  const scene = src.clone().crop({
    x: x0,
    y: SCENE_Y[0],
    w: x1 - x0 + 1,
    h: SCENE_Y[1] - SCENE_Y[0] + 1,
  });
  const sceneName = `era-${era.id}.jpg`;
  total += await save(scene, sceneName, 76);

  // 화석 — 이름은 원본 글자를 자르지 않고 앱에서 진짜 텍스트로 씁니다.
  const fossils = [];
  for (let i = 0; i < era.fossils.length; i++) {
    const f = era.fossils[i];
    const crop = src.clone().crop({
      x: f.x[0],
      y: FOSSIL_Y[0],
      w: f.x[1] - f.x[0] + 1,
      h: FOSSIL_Y[1] - FOSSIL_Y[0] + 1,
    });
    const name = `fossil-${era.id}-${i + 1}.jpg`;
    total += await save(crop, name, 80);
    fossils.push({ src: `/img/${name}`, label: f.label });
  }

  out.eras[era.id] = {
    scene: `/img/${sceneName}`,
    sceneAlt: era.sceneAlt,
    sceneQuestion: era.sceneQuestion ?? null,
    fossils,
  };
  console.log(`${era.id.padEnd(12)} 장면 1 + 화석 ${fossils.length}`);
}

writeFileSync(join(DATA_DIR, 'era-images.json'), JSON.stringify(out), 'utf8');
console.log(`\n이미지 ${4 + ERAS.reduce((n, e) => n + e.fossils.length, 0)}개, 합계 ${(total / 1024).toFixed(0)}KB`);
