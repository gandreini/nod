let holds = 0;

export function keepLive() {
  holds += 1;
  return () => {
    holds -= 1;
  };
}

export function liveHeld() {
  return holds > 0;
}
