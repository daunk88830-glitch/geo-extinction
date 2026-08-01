import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';

/* Firebase 초기화. 앱 전체에서 이 파일의 auth / db 하나만 씁니다.
 *
 * 값은 .env.local 에서 읽습니다. Vite 는 VITE_ 로 시작하는 변수만
 * 브라우저 코드에 넘겨줍니다.
 *
 * ── apiKey 가 브라우저에 노출되는 게 괜찮은가? ──────────────────
 * 괜찮습니다. Firebase 의 apiKey 는 비밀번호가 아니라 "어느 프로젝트인지"
 * 가리키는 주소표에 가깝습니다. 실제 방어선은 firestore.rules 입니다.
 * 그래도 .env.local 에 두어 git 저장소에는 남기지 않습니다.
 */

const cfg = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID,
};

/** .env.local 이 아직 안 채워졌으면 false. 이때 앱은 Firebase 없이 동작합니다. */
export const configured = Object.values(cfg).every((v) => typeof v === 'string' && v.length > 0);

/* ── 세션(수업 단위) ──────────────────────────────────────────
 * 반마다 데이터를 나누는 칸막이입니다. sessions/{세션}/... 아래에 모든 것이
 * 들어가므로, 세션이 다르면 학생 명단도 히트맵도 칸 점유도 완전히 분리됩니다.
 *
 * 빌드에 고정해 두면 반이 바뀔 때마다 다시 배포해야 합니다. 반이 9개이고
 * 수업 날짜도 제각각이라, 실행 시점에 정하도록 했습니다. 정하는 순서는
 *
 *   1) 주소의 ?s= 값        교사가 반별 링크나 QR 로 나눠 줄 때
 *   2) 이 브라우저에 저장된 값  한 번 고르면 새로고침해도 유지
 *   3) .env 의 기본값        아무것도 없을 때
 *
 * 앞에 붙는 VITE_SESSION_PREFIX 는 학기 구분용입니다.
 * 예: 접두사 "2026-1학기-" + 반 "3반" → "2026-1학기-3반"
 * 내년에 같은 반 번호를 다시 써도 자료가 섞이지 않습니다.
 */
const SESSION_PREFIX = import.meta.env.VITE_SESSION_PREFIX || '';
const LS_SESSION = 'geo:session';

function resolveSession() {
  try {
    // 해시 라우터를 쓰므로 ?s= 가 # 앞뒤 어디에 있어도 찾습니다.
    const q = new URLSearchParams(location.search);
    const h = location.hash.includes('?')
      ? new URLSearchParams(location.hash.slice(location.hash.indexOf('?')))
      : null;
    const fromUrl = q.get('s') || h?.get('s');
    if (fromUrl) {
      localStorage.setItem(LS_SESSION, fromUrl);
      return SESSION_PREFIX + fromUrl;
    }
    const saved = localStorage.getItem(LS_SESSION);
    if (saved) return SESSION_PREFIX + saved;
  } catch {
    /* 사생활 보호 모드 등에서 저장이 막혀 있어도 아래 기본값으로 이어집니다. */
  }
  return import.meta.env.VITE_SESSION_ID || 'default';
}

let sessionId = resolveSession();

/** 지금 쓰는 세션. 실행 중에 바뀔 수 있으므로 항상 이 함수로 읽으세요. */
export const getSessionId = () => sessionId;

/** 반을 고르면 세션이 바뀝니다. 이후의 모든 읽기·쓰기가 그 반으로 갑니다. */
export function setSessionKey(key) {
  sessionId = SESSION_PREFIX + key;
  try {
    localStorage.setItem(LS_SESSION, key);
  } catch {
    /* 무시 */
  }
  return sessionId;
}

/** 화면에 보여줄 짧은 이름 (접두사를 뗀 값) */
export function getSessionKey() {
  try {
    return localStorage.getItem(LS_SESSION) || '';
  } catch {
    return '';
  }
}

let app = null;
let auth = null;
let db = null;

if (configured) {
  app = initializeApp(cfg);
  auth = getAuth(app);

  /* experimentalAutoDetectLongPolling:
     학교 와이파이·방화벽이 WebSocket 을 막는 경우가 흔합니다. 이 옵션이 있으면
     Firestore 가 막힌 것을 감지해 일반 HTTP 방식으로 자동 전환합니다.
     끄면 교실에서 실시간 갱신이 통째로 안 되는 사고가 납니다. 반드시 켜 두세요. */
  db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
} else {
  console.warn(
    '[firebase] .env.local 이 비어 있어 Firebase 없이 실행합니다.\n' +
      '로그인 정보는 이 브라우저에만 저장되고 서버에는 올라가지 않습니다.'
  );
}

export { app, auth, db };
