import './styles/base.css';
import './styles/home.css';
import './styles/timeline.css';

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
register('#/timeline', () => import('./views/timeline.js'));

/* 로그인 전에는 어떤 화면으로 들어와도 홈으로 보냅니다. */
setGuard((path) => {
  if (!store.isSignedIn() && path !== '#/home') return '#/home';
  if (store.isSignedIn() && path === '#/home') return '#/timeline';
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
