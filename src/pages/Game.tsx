import { useEffect, useRef, useState } from 'react';
import { Page } from '../components/ui';

interface Rock {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
}

/** Small space shooter. Drag or use ←/→; firing is automatic. */
export default function Game() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const [run, setRun] = useState(0);
  const best = Number(localStorage.getItem('satiago-game-best') ?? 0);

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const W = 360;
    const H = 480;
    c.width = W;
    c.height = H;
    let ship = W / 2;
    let target = ship;
    const keys = new Set<string>();
    const bullets: { x: number; y: number }[] = [];
    const rocks: Rock[] = [];
    const stars = Array.from({ length: 50 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 1.5 + 0.3 }));
    let t = 0;
    let pts = 0;
    let alive = true;
    let raf = 0;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#7c5cff';

    const toX = (e: PointerEvent) => ((e.clientX - c.getBoundingClientRect().left) / c.getBoundingClientRect().width) * W;
    const move = (e: PointerEvent) => (target = toX(e));
    const kd = (e: KeyboardEvent) => keys.add(e.key);
    const ku = (e: KeyboardEvent) => keys.delete(e.key);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerdown', move);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    const loop = () => {
      t++;
      if (keys.has('ArrowLeft')) target = ship - 12;
      if (keys.has('ArrowRight')) target = ship + 12;
      ship += (Math.min(W - 16, Math.max(16, target)) - ship) * 0.25;
      if (t % 10 === 0) bullets.push({ x: ship, y: H - 40 });
      if (t % Math.max(14, 45 - Math.floor(t / 300)) === 0) {
        const r = 10 + Math.random() * 18;
        rocks.push({ x: r + Math.random() * (W - 2 * r), y: -r, r, vy: 1.2 + Math.random() * 1.5 + t / 3000, vx: (Math.random() - 0.5) * 0.8 });
      }
      bullets.forEach((b) => (b.y -= 7));
      rocks.forEach((r) => {
        r.y += r.vy;
        r.x += r.vx;
      });
      for (let i = rocks.length - 1; i >= 0; i--) {
        const r = rocks[i];
        const hit = bullets.findIndex((b) => (b.x - r.x) ** 2 + (b.y - r.y) ** 2 < r.r ** 2);
        if (hit >= 0) {
          bullets.splice(hit, 1);
          rocks.splice(i, 1);
          pts += Math.round(40 - r.r);
          setScore(pts);
          continue;
        }
        if ((r.x - ship) ** 2 + (r.y - (H - 30)) ** 2 < (r.r + 12) ** 2) alive = false;
        if (r.y > H + r.r) rocks.splice(i, 1);
      }
      while (bullets.length && bullets[0].y < -10) bullets.shift();

      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      stars.forEach((s) => {
        s.y = (s.y + s.s) % H;
        ctx.globalAlpha = s.s / 2;
        ctx.fillRect(s.x, s.y, s.s, s.s);
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffd36b';
      bullets.forEach((b) => ctx.fillRect(b.x - 1.5, b.y, 3, 9));
      ctx.fillStyle = '#7a6f66';
      rocks.forEach((r) => {
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = accent.trim();
      ctx.beginPath();
      ctx.moveTo(ship, H - 46);
      ctx.lineTo(ship - 14, H - 18);
      ctx.lineTo(ship + 14, H - 18);
      ctx.closePath();
      ctx.fill();

      if (alive) raf = requestAnimationFrame(loop);
      else {
        if (pts > Number(localStorage.getItem('satiago-game-best') ?? 0)) localStorage.setItem('satiago-game-best', String(pts));
        setOver(true);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerdown', move);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, [run]);

  return (
    <Page title="Mini game" back>
      <div className="row between small" style={{ marginBottom: 8 }}>
        <span>
          Score <b>{score}</b>
        </span>
        <span className="muted">Best {Math.max(best, score)}</span>
      </div>
      <canvas ref={ref} className="game" aria-label="Space shooter game" />
      {over && (
        <button
          className="btn primary block"
          style={{ marginTop: 10 }}
          onClick={() => {
            setOver(false);
            setScore(0);
            setRun((r) => r + 1);
          }}
        >
          Play again
        </button>
      )}
      <p className="muted tiny">Drag on the canvas or use the arrow keys. A quick break between meals and check-ins.</p>
    </Page>
  );
}
