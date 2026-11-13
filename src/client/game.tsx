import './index.css';

import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  isSolved,
  positionsOf,
  shareText,
  solve,
  tryMove,
  type Move,
  type Car,
} from '../shared/puzzle';
import type { LeaderboardResponse, MyResult, SubmitResponse, TodayResponse } from '../shared/api';
import { getLeaderboard, getToday, shareComment, submit } from './api';
import { Board, carName } from './Board';
import { copyText, promptLogin, share, toast } from './host';
import { fmtTime, fmtTimeTenths } from './format';
import { launchConfetti } from './confetti';

type Snapshot = { pos: number[]; moves: Move[] };

type Outcome = {
  result: MyResult;
  server: SubmitResponse | null;
  prior: boolean; // opened from an earlier solve rather than a fresh win
  error: string | null;
};

function useNextPuzzleCountdown(): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const mins = Math.max(0, Math.floor((next - now) / 60000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

function App() {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    getToday()
      .then(setToday)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (error) {
    return (
      <div className="error" role="alert">
        <div>{error}</div>
        <button className="btn primary" onClick={load}>
          Try again
        </button>
      </div>
    );
  }
  if (!today) {
    return (
      <div className="loading" role="status">
        <div className="spinner" />
        <div>Loading today&apos;s puzzle...</div>
      </div>
    );
  }
  return <Game today={today} reload={setToday} />;
}

function Game({ today, reload }: { today: TodayResponse; reload: (t: TodayResponse) => void }) {
  const puzzle = today.puzzle;
  const cars: Car[] = puzzle.cars;
  const initial = useMemo(() => positionsOf(cars), [cars]);

  const [state, setState] = useState<Snapshot>({ pos: initial, moves: [] });
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState<Move | null>(null);
  const [hintText, setHintText] = useState('');
  const [hintsUsed, setHintsUsed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [won, setWon] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(() =>
    today.result ? { result: today.result, server: null, prior: true, error: null } : null
  );
  const [panel, setPanel] = useState<'none' | 'help' | 'lb'>('none');
  const [announce, setAnnounce] = useState('');
  const [shown, setShown] = useState(today.result ? 'result' : 'none');

  const startRef = useRef<number | null>(null);
  const timeRef = useRef(0);
  const wonRef = useRef(false);

  // timer
  useEffect(() => {
    const t = window.setInterval(() => {
      if (startRef.current !== null && !wonRef.current) {
        timeRef.current = performance.now() - startRef.current;
        setElapsed(timeRef.current);
      }
    }, 200);
    return () => window.clearInterval(t);
  }, []);

  const finish = useCallback(
    (snap: Snapshot, ms: number, hints: boolean) => {
      wonRef.current = true;
      setWon(true);
      setExiting(true);
      setSelected(null);
      setHint(null);
      setHintText('');
      setAnnounce(`Solved in ${snap.moves.length} moves.`);
      launchConfetti();
      const local: MyResult = { moves: snap.moves.length, ms, hints };
      const sub = submit({ moves: snap.moves, ms, hints });
      window.setTimeout(() => {
        setOutcome((o) => o ?? { result: local, server: null, prior: false, error: null });
        setShown('result');
      }, 1150);
      sub
        .then((server) => {
          setOutcome({ result: server.result, server, prior: false, error: null });
          reload({
            ...today,
            result: server.result,
            streak: server.streak,
            solveCount: server.solveCount,
            histogram: server.histogram,
          });
        })
        .catch((e: Error) => setOutcome({ result: local, server: null, prior: false, error: e.message }));
    },
    [reload, today]
  );

  const stateRef = useRef<Snapshot>(state);
  const applyMove = useCallback(
    (carId: number, delta: number) => {
      if (wonRef.current || delta === 0) return;
      const cur = stateRef.current;
      const next = tryMove(cars, cur.pos, carId, delta);
      if (!next) return;
      if (startRef.current === null) startRef.current = performance.now();
      const last = cur.moves[cur.moves.length - 1];
      let moves: Move[];
      if (last && last.carId === carId) {
        // consecutive slides of the same car count as one move
        const sum = last.delta + delta;
        moves = sum === 0 ? cur.moves.slice(0, -1) : [...cur.moves.slice(0, -1), { carId, delta: sum }];
      } else {
        moves = [...cur.moves, { carId, delta }];
      }
      const snap = { pos: next, moves };
      stateRef.current = snap;
      setState(snap);
      setHistory((h) => [...h, cur]);
      setHint(null);
      setHintText('');
      if (isSolved(cars, next)) {
        const ms = performance.now() - (startRef.current ?? performance.now());
        timeRef.current = ms;
        setElapsed(ms);
        finish(snap, ms, hintsUsedRef.current);
      }
    },
    [cars, finish]
  );

  const hintsUsedRef = useRef(false);
  useEffect(() => {
    hintsUsedRef.current = hintsUsed;
  }, [hintsUsed]);

  // keyboard: arrows move the selected car when focus is not on a car itself
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (selected === null || panel !== 'none' || shown === 'result') return;
      if ((document.activeElement as HTMLElement | null)?.classList?.contains('car')) return;
      const c = cars[selected];
      if (!c) return;
      const map: Record<string, [boolean, number]> = {
        ArrowLeft: [true, -1],
        ArrowRight: [true, 1],
        ArrowUp: [false, -1],
        ArrowDown: [false, 1],
      };
      const k = map[e.key];
      if (!k) return;
      e.preventDefault();
      if (k[0] === c.horiz) applyMove(c.id, k[1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, cars, applyMove, panel, shown]);

  const undo = () => {
    if (wonRef.current) return;
    const prev = history[history.length - 1];
    if (!prev) return;
    stateRef.current = prev;
    setState(prev);
    setHistory(history.slice(0, -1));
    setHint(null);
    setHintText('');
  };

  const reset = () => {
    wonRef.current = false;
    startRef.current = null;
    timeRef.current = 0;
    setElapsed(0);
    setWon(false);
    setExiting(false);
    stateRef.current = { pos: initial, moves: [] };
    setState(stateRef.current);
    setHistory([]);
    setSelected(null);
    setHint(null);
    setHintText('');
    setShown('none');
    setOutcome(null);
  };

  const showHint = () => {
    if (wonRef.current) return;
    const r = solve(cars, stateRef.current.pos);
    const m = r?.moves[0];
    if (!m) {
      toast('No hint available');
      return;
    }
    const c = cars.find((x) => x.id === m.carId)!;
    const dir = c.horiz ? (m.delta > 0 ? 'right' : 'left') : m.delta > 0 ? 'down' : 'up';
    setHint(m);
    setSelected(m.carId);
    setHintsUsed(true);
    setHintText(`Slide the ${carName(m.carId)} car ${Math.abs(m.delta)} ${dir}`);
    setAnnounce(`Hint: slide the ${carName(m.carId)} car ${Math.abs(m.delta)} ${dir}`);
  };

  const movesCount = state.moves.length;

  return (
    <main className="app">
      <header className="top">
        <div className="title">
          <h1>Gridlock Daily #{puzzle.number}</h1>
          <small>
            {puzzle.weekday} · {puzzle.difficulty} · {puzzle.day}
            {!today.isToday ? ' · past puzzle' : ''}
          </small>
        </div>
        <div className="top-actions">
          <button className="icon-btn" aria-label="Leaderboard" title="Leaderboard" onClick={() => setPanel('lb')}>
            🏆
          </button>
          <button className="icon-btn" aria-label="How to play" title="How to play" onClick={() => setPanel('help')}>
            ?
          </button>
        </div>
      </header>

      <section className="stats" aria-label="Stats">
        <div className="stat">
          <b>{movesCount}</b>
          <span>Moves</span>
        </div>
        <div className="stat">
          <b>{puzzle.par}</b>
          <span>Par</span>
        </div>
        <div className="stat">
          <b>{fmtTime(elapsed)}</b>
          <span>Time</span>
        </div>
        <div className="stat">
          <b>{today.streak.current > 0 ? `🔥${today.streak.current}` : '–'}</b>
          <span>Streak</span>
        </div>
      </section>

      <Board
        cars={cars}
        pos={state.pos}
        selected={selected}
        hint={hint}
        locked={won}
        exiting={exiting}
        onMove={applyMove}
        onSelect={setSelected}
      />

      <div className="hint-line" aria-live="polite">
        {hintText ? (
          <>
            Hint: <b>{hintText}</b>
          </>
        ) : selected !== null && !won ? (
          <>
            {carName(selected)} car selected. Drag it or use arrow keys.
          </>
        ) : (
          'Drag cars to clear a path for the red one.'
        )}
      </div>

      <div className="controls">
        <button className="btn" onClick={undo} disabled={history.length === 0 || won}>
          ↶ Undo
        </button>
        <button className="btn" onClick={reset} disabled={movesCount === 0 && !won}>
          ↻ Reset
        </button>
        <button className="btn" onClick={showHint} disabled={won}>
          💡 Hint
        </button>
      </div>

      {hintsUsed && !won && <p className="note">Hints used: this run is marked and kept off the leaderboard.</p>}
      {!today.loggedIn && (
        <p className="note">
          Playing logged out. <button onClick={promptLogin}>Log in</button> to save your streak and join the leaderboard.
        </p>
      )}

      <div className="sr-only" role="status" aria-live="assertive">
        {announce}
      </div>

      {panel === 'help' && <Help onClose={() => setPanel('none')} par={puzzle.par} />}
      {panel === 'lb' && <Leaderboard onClose={() => setPanel('none')} today={today} />}
      {shown === 'result' && outcome && (
        <ResultSheet
          outcome={outcome}
          today={today}
          hintsUsed={hintsUsed}
          onClose={() => setShown('closed')}
          onReplay={reset}
          onLeaderboard={() => setPanel('lb')}
        />
      )}
      {shown === 'closed' && outcome && (
        <div className="controls">
          <button className="btn primary" onClick={() => setShown('result')}>
            Show result
          </button>
        </div>
      )}
    </main>
  );
}

function Help({ onClose, par }: { onClose: () => void; par: number }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="How to play" onClick={(e) => e.stopPropagation()}>
        <h2>How to play</h2>
        <p>Free the red car by sliding it out through the exit on the right.</p>
        <ul>
          <li>Drag a car along its length, or tap it and use the arrow keys.</li>
          <li>Cars cannot turn or jump over other cars.</li>
          <li>Sliding one car any distance counts as one move, and so does sliding it back and forth in a row.</li>
          <li>Today&apos;s par is {par} moves, the fewest possible.</li>
          <li>Hints show the next best move, but a run with hints stays off the leaderboard.</li>
        </ul>
        <h3>Daily puzzle</h3>
        <p>Everyone gets the same puzzle each UTC day. It starts easy on Mondays and gets harder through the week.</p>
        <div className="row">
          <button className="btn primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function Leaderboard({ onClose, today }: { onClose: () => void; today: TodayResponse }) {
  const [lb, setLb] = useState<LeaderboardResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getLeaderboard()
      .then(setLb)
      .catch((e: Error) => setErr(e.message));
  }, []);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Leaderboard" onClick={(e) => e.stopPropagation()}>
        <h2>Leaderboard</h2>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          #{today.puzzle.number} · fewest moves, then fastest time. Runs with hints are not ranked.
        </p>
        {err && <div className="empty">{err}</div>}
        {!lb && !err && <div className="empty">Loading...</div>}
        {lb && lb.entries.length === 0 && <div className="empty">No ranked solves yet. Be the first!</div>}
        {lb && lb.entries.length > 0 && (
          <table className="lb">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Moves</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {lb.entries.map((e) => (
                <tr key={e.username} className={lb.me && lb.me.username === e.username ? 'me' : ''}>
                  <td>{e.rank}</td>
                  <td>u/{e.username}</td>
                  <td>{e.moves}</td>
                  <td>{fmtTimeTenths(e.ms)}</td>
                </tr>
              ))}
              {lb.me && !lb.entries.some((e) => e.username === lb.me!.username) && (
                <tr className="me">
                  <td>{lb.me.rank}</td>
                  <td>u/{lb.me.username}</td>
                  <td>{lb.me.moves}</td>
                  <td>{fmtTimeTenths(lb.me.ms)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {lb && lb.total > 0 && <p className="note">{lb.total} ranked solve{lb.total === 1 ? '' : 's'} today</p>}
        <div className="row">
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Histogram({ hist, par, mine }: { hist: Record<string, number>; par: number; mine: number }) {
  const counts = Object.entries(hist)
    .map(([k, v]) => [parseInt(k, 10), v] as const)
    .filter(([, v]) => v > 0);
  if (counts.length === 0) return null;
  const all = counts.map(([k]) => k).concat([par, mine]);
  const lo = Math.min(...all);
  const hi = Math.min(Math.max(...all), lo + 24);
  const bars: { m: number; n: number }[] = [];
  for (let m = lo; m <= hi; m++) bars.push({ m, n: hist[String(m)] ?? 0 });
  const max = Math.max(1, ...bars.map((b) => b.n));
  return (
    <>
      <h3>How everyone did</h3>
      <div className="hist" role="img" aria-label={`Move counts of other players. Yours: ${mine}. Par: ${par}.`}>
        {bars.map((b) => (
          <div
            key={b.m}
            className={`bar${b.m === mine ? ' me' : b.m === par ? ' par' : ''}`}
            style={{ height: `${Math.max(6, (b.n / max) * 100)}%`, opacity: b.n === 0 && b.m !== mine ? 0.35 : 1 }}
            title={`${b.m} moves: ${b.n}`}
          />
        ))}
      </div>
      <div className="hist-axis">
        <span>{lo} moves</span>
        <span>par {par} (green) · you (orange)</span>
        <span>{hi}</span>
      </div>
    </>
  );
}

function ResultSheet({
  outcome,
  today,
  hintsUsed,
  onClose,
  onReplay,
  onLeaderboard,
}: {
  outcome: Outcome;
  today: TodayResponse;
  hintsUsed: boolean;
  onClose: () => void;
  onReplay: () => void;
  onLeaderboard: () => void;
}) {
  const { result, server } = outcome;
  const par = today.puzzle.par;
  const countdown = useNextPuzzleCountdown();
  const [rank, setRank] = useState<number | null>(server?.rank ?? null);
  const [total, setTotal] = useState<number | null>(null);
  const [confirmComment, setConfirmComment] = useState(false);
  const [posted, setPosted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!today.loggedIn || result.hints) return;
    getLeaderboard()
      .then((lb) => {
        setTotal(lb.total);
        if (lb.me) setRank(lb.me.rank);
      })
      .catch(() => undefined);
  }, [today.loggedIn, result.hints, server]);

  const streak = server ? server.streak.current : today.streak.current;
  const solveCount = server ? server.solveCount : today.solveCount;
  const hist = server ? server.histogram : today.histogram;
  const text = shareText({
    number: today.puzzle.number,
    moves: result.moves,
    par,
    streak,
    hints: result.hints || hintsUsed,
  });
  const diff = result.moves - par;
  const headline = diff <= 0 ? 'Perfect run!' : diff <= 2 ? 'Nicely done!' : 'Solved!';
  const saved = server ? server.saved : today.loggedIn;

  const copy = async () => {
    const ok = await copyText(text);
    toast(ok ? 'Result copied' : 'Could not copy. Select the text instead.');
  };

  const postComment = async () => {
    setBusy(true);
    try {
      await shareComment();
      setPosted(true);
      toast('Comment posted');
    } catch (e) {
      toast((e as Error).message || 'Could not post the comment');
    } finally {
      setBusy(false);
      setConfirmComment(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Result" onClick={(e) => e.stopPropagation()}>
        <div className="result-head">
          <div className="sub">Gridlock Daily #{today.puzzle.number}</div>
          <div className="big">{headline}</div>
          <div className="sub">
            {result.moves} moves (par {par}) · {fmtTimeTenths(result.ms)}
          </div>
          <div>
            {diff <= 0 && <span className="badge good">Par!</span>}
            {diff > 0 && <span className="badge">+{diff} over par</span>}
            {(result.hints || hintsUsed) && <span className="badge warn">Hints used</span>}
            {streak > 0 && saved && <span className="badge good">🔥 {streak}-day streak</span>}
            {rank !== null && (
              <span className="badge">
                Rank #{rank}
                {total ? ` of ${total}` : ''}
              </span>
            )}
            {server && server.saved && !server.improved && !outcome.prior && <span className="badge">Best run kept</span>}
          </div>
        </div>

        {outcome.error && <p className="note">Could not save to the server: {outcome.error}</p>}
        {!today.loggedIn && (
          <p className="note">
            Result not saved because you are logged out. <button onClick={promptLogin}>Log in</button> to keep your streak.
          </p>
        )}

        <Histogram hist={hist} par={par} mine={result.moves} />
        {solveCount > 0 && <p className="note">{solveCount} player{solveCount === 1 ? '' : 's'} solved today</p>}

        <div className="share-box" aria-label="Shareable result">
          {text}
        </div>

        <div className="row">
          <button className="btn primary" onClick={copy}>
            Copy result
          </button>
          <button
            className="btn"
            onClick={async () => {
              const ok = await share(text);
              if (!ok) copy();
            }}
          >
            Share
          </button>
        </div>
        {today.loggedIn && saved && (
          <div className="row">
            {!confirmComment && !posted && (
              <button className="btn" onClick={() => setConfirmComment(true)}>
                Share as comment
              </button>
            )}
            {confirmComment && (
              <>
                <button className="btn primary" disabled={busy} onClick={postComment}>
                  Post this as a comment from my account
                </button>
                <button className="btn" onClick={() => setConfirmComment(false)}>
                  Cancel
                </button>
              </>
            )}
            {posted && <span className="note">Comment posted. Thanks for sharing!</span>}
          </div>
        )}
        <div className="row">
          <button className="btn" onClick={onLeaderboard}>
            🏆 Leaderboard
          </button>
          <button
            className="btn"
            onClick={() => {
              onReplay();
            }}
          >
            {diff > 0 ? 'Try for fewer moves' : 'Play again'}
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="note">Next puzzle in {countdown} (00:00 UTC)</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
