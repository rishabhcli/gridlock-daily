import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as RPointerEvent } from 'react';
import { SIZE, carColor, slideRange, type Car, type Move } from '../shared/puzzle';

export const CAR_NAMES = [
  'Red',
  'Blue',
  'Yellow',
  'Green',
  'Purple',
  'Pink',
  'Teal',
  'Orange',
  'Gray',
  'Lime',
  'Brown',
  'Indigo',
  'Gold',
  'Mint',
];

export function carName(id: number): string {
  return CAR_NAMES[id % CAR_NAMES.length]!;
}

type Drag = { id: number; px: number; anim: boolean };

type Props = {
  cars: Car[];
  pos: number[];
  selected: number | null;
  hint: Move | null;
  locked: boolean;
  exiting: boolean;
  onMove: (carId: number, delta: number) => void;
  onSelect: (carId: number | null) => void;
};

const pct = (n: number) => `${(n / SIZE) * 100}%`;

function rect(c: Car, p: number): CSSProperties {
  const x = c.horiz ? p : c.x;
  const y = c.horiz ? c.y : p;
  return {
    left: pct(x),
    top: pct(y),
    width: pct(c.horiz ? c.len : 1),
    height: pct(c.horiz ? 1 : c.len),
  };
}

export function Board({ cars, pos, selected, hint, locked, exiting, onMove, onSelect }: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const gesture = useRef<{ id: number; start: number; min: number; max: number; moved: boolean; px: number } | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const cell = () => (boardRef.current ? boardRef.current.clientWidth / SIZE : 60);

  const onDown = (e: RPointerEvent<HTMLDivElement>, i: number) => {
    if (locked || e.button > 0) return;
    const c = cars[i]!;
    const [back, fwd] = slideRange(cars, pos, i);
    const cs = cell();
    gesture.current = {
      id: c.id,
      start: c.horiz ? e.clientX : e.clientY,
      min: -back * cs,
      max: fwd * cs,
      moved: false,
      px: 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMovePtr = (e: RPointerEvent<HTMLDivElement>, i: number) => {
    const g = gesture.current;
    if (!g || g.id !== cars[i]!.id) return;
    const c = cars[i]!;
    const raw = (c.horiz ? e.clientX : e.clientY) - g.start;
    const px = Math.max(g.min, Math.min(g.max, raw));
    if (Math.abs(raw) > 5) g.moved = true;
    g.px = px;
    if (g.moved) setDrag({ id: g.id, px, anim: false });
  };

  const settle = (id: number, residual: number) => {
    setDrag({ id, px: residual, anim: false });
    const t1 = window.setTimeout(() => {
      setDrag({ id, px: 0, anim: true });
      const t2 = window.setTimeout(() => setDrag(null), 220);
      timers.current.push(t2);
    }, 30);
    timers.current.push(t1);
  };

  const onUp = (e: RPointerEvent<HTMLDivElement>, i: number) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.id !== cars[i]!.id) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!g.moved) {
      setDrag(null);
      onSelect(selected === g.id ? null : g.id);
      return;
    }
    const cs = cell();
    const delta = Math.round(g.px / cs);
    onSelect(g.id);
    if (delta !== 0) {
      onMove(g.id, delta);
      settle(g.id, g.px - delta * cs);
    } else {
      settle(g.id, g.px);
    }
  };

  const onCancel = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g) settle(g.id, g.px);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>, c: Car) => {
    if (locked) return;
    const keyDelta: Record<string, [boolean, number]> = {
      ArrowLeft: [true, -1],
      ArrowRight: [true, 1],
      ArrowUp: [false, -1],
      ArrowDown: [false, 1],
    };
    const k = keyDelta[e.key];
    if (k) {
      e.preventDefault();
      if (k[0] === c.horiz) onMove(c.id, k[1]);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(selected === c.id ? null : c.id);
    }
  };

  const hintCar = hint ? cars.find((c) => c.id === hint.carId) : null;
  const hintIdx = hintCar ? cars.indexOf(hintCar) : -1;

  return (
    <div className="board-wrap">
      <div className="frame">
        <div
          className="board"
          ref={boardRef}
          role="group"
          aria-label="Puzzle board, 6 by 6. Select a car, then use arrow keys or drag to slide it."
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onSelect(null);
          }}
        >
          {hintCar && hint && hintIdx >= 0 && <div className="ghost" style={rect(hintCar, pos[hintIdx]! + hint.delta)} />}
          {cars.map((c, i) => {
            const isRed = c.id === 0;
            const leaving = isRed && exiting;
            const style: CSSProperties = { ...rect(c, pos[i]!), ['--c' as string]: carColor(c.id) };
            if (leaving) style.left = pct(SIZE + 1);
            const d = drag && drag.id === c.id ? drag : null;
            if (d) style.transform = c.horiz ? `translateX(${d.px}px)` : `translateY(${d.px}px)`;
            const cls = [
              'car',
              c.horiz ? 'h' : 'v',
              isRed ? 'red' : '',
              d && !d.anim ? 'dragging' : '',
              selected === c.id ? 'selected' : '',
              hint && hint.carId === c.id ? 'hinted' : '',
              leaving ? 'leaving' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const col = c.horiz ? pos[i]! + 1 : c.x + 1;
            const row = c.horiz ? c.y + 1 : pos[i]! + 1;
            return (
              <div
                key={c.id}
                className={cls}
                style={style}
                role="button"
                tabIndex={locked ? -1 : 0}
                aria-pressed={selected === c.id}
                aria-label={`${carName(c.id)} car${isRed ? ' (goal)' : ''}, ${c.horiz ? 'horizontal' : 'vertical'}, length ${c.len}, column ${col} row ${row}. Arrow keys ${c.horiz ? 'left and right' : 'up and down'} slide it.`}
                onPointerDown={(e) => onDown(e, i)}
                onPointerMove={(e) => onMovePtr(e, i)}
                onPointerUp={(e) => onUp(e, i)}
                onPointerCancel={onCancel}
                onKeyDown={(e) => onKey(e, c)}
              >
                <div className="body">
                  <div className="glass" />
                  <div className="lights" />
                </div>
              </div>
            );
          })}
        </div>
        <div className="exit" aria-hidden="true">
          <span>›</span>
        </div>
      </div>
    </div>
  );
}
