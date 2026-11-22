export function redirectSystemPath({ initial }: { path: string; initial: boolean }) {
  return initial ? '/' : null;
}
