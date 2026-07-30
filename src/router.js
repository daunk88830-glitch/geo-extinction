/* 주소창의 # 뒤 글자로 화면을 바꾸는 아주 작은 라우터.
 * 예) http://localhost:5173/#/timeline  →  타임라인 화면
 *
 * 화면(view)은 이런 모양의 함수입니다.
 *   export default async function view(outlet) {
 *     outlet.innerHTML = '...';
 *     return () => { ...정리할 일... };   // 반환은 선택
 *   }
 * 반환한 함수는 다른 화면으로 넘어갈 때 자동 호출됩니다.
 * (스크롤 이벤트 해제, Firestore 구독 해제 등을 여기서 합니다.)
 */

import * as store from './store.js';

const routes = new Map();
let outlet = null;
let cleanup = null;
let guard = null;

export function register(path, loader) {
  routes.set(path, loader);
}

/** 라우팅 전에 통과 여부를 검사하는 함수를 답니다.
 *  다른 경로를 문자열로 반환하면 그쪽으로 보냅니다. */
export function setGuard(fn) {
  guard = fn;
}

export function go(path) {
  if (location.hash === path) render();
  else location.hash = path;
}

export function start(el) {
  outlet = el;
  window.addEventListener('hashchange', render);
  render();
}

function currentPath() {
  return location.hash || '#/home';
}

async function render() {
  let path = currentPath();

  if (guard) {
    const redirect = guard(path);
    if (redirect && redirect !== path) {
      location.hash = redirect;
      return; // hashchange 가 다시 render() 를 부릅니다
    }
  }

  const loader = routes.get(path);
  if (!loader) {
    outlet.innerHTML =
      '<div class="wrap" style="padding:40px 20px"><h1>없는 화면입니다</h1>' +
      '<p style="margin-top:12px"><a href="#/timeline">타임라인으로 돌아가기</a></p></div>';
    return;
  }

  // 이전 화면 정리
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch (e) { console.error('[router] 정리 중 오류:', e); }
  }
  cleanup = null;

  store.set('route', path);
  outlet.innerHTML = '';
  window.scrollTo(0, 0);

  try {
    const mod = await loader();
    const view = mod.default ?? mod;
    cleanup = await view(outlet);
  } catch (e) {
    console.error('[router] 화면을 여는 중 오류:', e);
    outlet.innerHTML =
      '<div class="wrap" style="padding:40px 20px"><h1>화면을 열지 못했습니다</h1>' +
      `<p style="margin-top:12px;color:var(--muted)">${escapeHtml(e.message)}</p></div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
