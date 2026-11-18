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

export type Zoom = { scale: number; x: number; y: number };
type Point = { x: number; y: number };

export const maxZoom = 4;

export function unzoom(touch: Point, box: Size, zoom: Zoom): Point {
  const cx = box.width / 2;
  const cy = box.height / 2;
  return {
    x: cx + (touch.x - cx - zoom.x) / zoom.scale,
    y: cy + (touch.y - cy - zoom.y) / zoom.scale,
  };
}

export function clampZoom(zoom: Zoom, box: Size, image: Size): Zoom {
  const scale = Math.min(maxZoom, Math.max(1, zoom.scale));
  if (!box.width || !image.width) return { scale, x: 0, y: 0 };
  const shown = fit(box, image);
  const maxX = Math.max(0, (shown.width * scale - box.width) / 2);
  const maxY = Math.max(0, (shown.height * scale - box.height) / 2);
  const limit = (value: number, max: number) => Math.min(max, Math.max(-max, value)) || 0;
  return { scale, x: limit(zoom.x, maxX), y: limit(zoom.y, maxY) };
}

export function pinchZoom(
  start: Zoom,
  startMid: Point,
  startDistance: number,
  mid: Point,
  distance: number,
  box: Size,
  image: Size,
): Zoom {
  const cx = box.width / 2;
  const cy = box.height / 2;
  const scale = Math.min(maxZoom, Math.max(1, (start.scale * distance) / startDistance));
  const ux = (startMid.x - cx - start.x) / start.scale;
  const uy = (startMid.y - cy - start.y) / start.scale;
  return clampZoom({ scale, x: mid.x - cx - ux * scale, y: mid.y - cy - uy * scale }, box, image);
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
