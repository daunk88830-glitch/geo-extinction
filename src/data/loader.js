/* public/data/*.json 을 읽어옵니다.
 * public/ 안의 파일은 빌드 없이 그대로 서빙되므로 주소가 '/data/...' 입니다.
 * 같은 파일을 두 번 요청하지 않도록 캐시해 둡니다.
 */

import * as store from '../store.js';

const cache = new Map();

async function loadJSON(url) {
  if (cache.has(url)) return cache.get(url);

  const p = fetch(url).then((res) => {
    if (!res.ok) throw new Error(`${url} 을(를) 불러오지 못했습니다 (HTTP ${res.status})`);
    return res.json();
  });

  cache.set(url, p);
  try {
    return await p;
  } catch (e) {
    cache.delete(url); // 실패한 요청은 캐시에서 빼서 재시도가 가능하게
    throw e;
  }
}

export async function loadEras() {
  const json = await loadJSON('/data/eras.json');
  store.patch('data', { eras: json });
  return json;
}

export async function loadHypotheses() {
  const json = await loadJSON('/data/hypotheses.json');
  store.patch('data', { hypotheses: json });
  return json;
}

/* Day 2 에서 scripts/build-data.mjs 가 data-raw/*.csv 를 변환해
   아래 두 파일을 만들어 줄 예정입니다. 아직 없습니다.
export async function loadDiversity() { ... '/data/diversity.json' }
export async function loadClimate()   { ... '/data/climate.json'   }
*/
