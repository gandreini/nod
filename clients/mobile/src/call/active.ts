import { keepLive } from '../chat/live-holds';

let calls = 0;
let opening: number | undefined;

export function openCall() {
  calls += 1;
  opening = undefined;
  const release = keepLive();
  return () => {
    calls -= 1;
    release();
  };
}

export function inCall() {
  return calls > 0;
}

export function claimCallStart(now = Date.now()) {
  if (calls > 0 || (opening !== undefined && now - opening < 2000)) return false;
  opening = now;
  return true;
}
