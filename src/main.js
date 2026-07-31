import './styles/base.css';
import './styles/home.css';
import './styles/timeline.css';
import './styles/explore.css';
import './styles/court.css';
import './styles/quiz.css';
import './styles/teacher.css';
import './styles/precheck.css';

import * as store from './store.js';
import { register, setGuard, start } from './router.js';

/* 앱 시작점.
 * 1) 저장된 로그인 정보를 복구하고
 * 2) 경로별 화면을 등록한 뒤
 * 3) 라우터를 켭니다.
 */

store.loadUserFromStorage();

/* 화면은 필요할 때 내려받습니다(동적 import).
   첫 화면이 빨리 뜨고, 교실 와이파이에서 초기 로딩이 가벼워집니다. */
register('#/home', () => import('./views/home.js'));
register('#/precheck', () => import('./views/precheck.js'));
register('#/timeline', () => import('./views/timeline.js'));
register('#/explore', () => import('./views/explore.js'));
register('#/court', () => import('./views/court.js'));
register('#/quiz', () => import('./views/quiz.js'));
register('#/teacher', () => import('./views/teacher.js'));

/* 로그인 전에는 어떤 화면으로 들어와도 홈으로 보냅니다.
   교사 화면만 예외입니다 — 학생 로그인과 별개로 자체 로그인을 씁니다. */
setGuard((path) => {
  if (path === '#/teacher') return null;
  if (!store.isSignedIn() && path !== '#/home') return '#/home';
  if (store.isSignedIn() && path === '#/home') return '#/precheck';
  return null;
});

/* 상단 바는 로그인 후에만 보입니다. */
const topbar = document.getElementById('topbar');
const who = document.getElementById('topbar-who');

function syncTopbar() {
  const signed = store.isSignedIn();
  topbar.hidden = !signed;
  document.body.classList.toggle('has-topbar', signed);
  if (signed) {
    const u = store.get('user');
    who.textContent = `${u.groupId}모둠 · ${u.name}`;
  }
}

store.subscribe('user', syncTopbar);
store.subscribe('route', syncTopbar);
syncTopbar();

start(document.getElementById('app'));

/* 화면을 먼저 띄우고, uid 복구는 뒤에서 조용히 처리합니다.
   Firebase SDK(gzip 약 150KB)를 첫 화면과 함께 내려받지 않으려고
   동적 import 로 미룹니다. 30명이 동시에 접속하는 교실에서
   첫 화면이 뜨는 속도가 눈에 띄게 달라집니다.
   Firebase 가 느리거나 막혀 있어도 타임라인은 그대로 보입니다. */
import('./services/auth.js')
  .then((m) => m.restoreAuth())
  .catch((e) => console.warn('[main] 인증 모듈을 불러오지 못했습니다:', e));
