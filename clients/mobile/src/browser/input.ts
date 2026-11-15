import type { BrowserHandoffInput } from '../../../../src/shared/browser-handoff';

export type HandoffInput = BrowserHandoffInput;
type Size = { width: number; height: number };

export const textPiece = 2000;

export function queueInput(queue: HandoffInput[], input: HandoffInput) {
  const last = queue.at(-1);
  if (
    last?.type === 'mouse' &&
    last.event === 'move' &&
    input.type === 'mouse' &&
    input.event === 'move'
  )
    queue[queue.length - 1] = input;
  else if (last?.type === 'wheel' && input.type === 'wheel')
    queue[queue.length - 1] = {
      type: 'wheel',
      deltaX: last.deltaX + input.deltaX,
      deltaY: last.deltaY + input.deltaY,
    };
  else if (
    last?.type === 'text' &&
    input.type === 'text' &&
    last.text.length + input.text.length <= textPiece
  )
    queue[queue.length - 1] = { type: 'text', text: last.text + input.text };
  else queue.push(input);
  return queue;
}

export function fit(box: Size, image: Size) {
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}

export function pointAt(touch: { x: number; y: number }, box: Size, image: Size) {
  if (!box.width || !box.height || !image.width || !image.height) return null;
  const shown = fit(box, image);
  const x = (touch.x - shown.left) / shown.width;
  const y = (touch.y - shown.top) / shown.height;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}

export function pageScale(box: Size, image: Size) {
  return image.width / fit(box, image).width;
}

export function tap(at: { x: number; y: number }): HandoffInput[] {
  return [
    { type: 'mouse', event: 'move', ...at },
    { type: 'mouse', event: 'down', ...at, button: 'left' },
    { type: 'mouse', event: 'up', ...at, button: 'left' },
  ];
}

export function textEdits(before: string, after: string): HandoffInput[] {
  let same = 0;
  while (same < before.length && same < after.length && before[same] === after[same]) same++;
  if (same && /[\uD800-\uDBFF]/.test(before[same - 1])) same--;
  const removed = [...before.slice(same)].length;
  const added = after.slice(same);
  return [
    ...Array.from({ length: removed }, () => ({ type: 'key' as const, key: 'Backspace' })),
    ...(added.match(/[\s\S]{1,2000}/gu) ?? []).map((text) => ({ type: 'text' as const, text })),
  ];
}
