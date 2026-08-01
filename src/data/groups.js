/* 모둠 구성.
 *
 * 대멸종이 5개이고 한 모둠이 사건 하나를 맡으므로 5모둠입니다.
 * 학급 인원이 달라 모둠 수를 바꾸려면 이 숫자만 고치면 됩니다 —
 * 홈 화면의 선택지, 원인 판정의 모둠 색 범례, 교사 대시보드가 모두 따라옵니다.
 * (firestore.rules 의 groupId 상한도 함께 맞춰야 합니다)
 */
export const GROUP_COUNT = 5;

export const GROUPS = Array.from({ length: GROUP_COUNT }, (_, i) => i + 1);
