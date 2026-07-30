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

/** 수업 1회 단위. 반마다 다르게 주면 데이터가 섞이지 않습니다. */
export const SESSION_ID = import.meta.env.VITE_SESSION_ID || 'default';

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
