/**
 * The demo clock. Simulated time runs at a configurable speed from a fixed start (21:40 IST on
 * the demo day by default), can be paused, sped up and reset, and is persisted so restarts
 * resume where the demo was.
 */
import type { DB } from '../db/db';

interface ClockRow {
  anchor_sim: number;
  anchor_wall_ms: number;
  speed: number;
  paused: number;
  demo_start: number;
}

export class Clock {
  private row: ClockRow;

  constructor(
    private db: DB,
    demoStart: number,
    speed: number,
    private wall: () => number = Date.now,
  ) {
    const existing = db.prepare('SELECT * FROM clock WHERE id = 1').get() as ClockRow | undefined;
    if (existing && existing.demo_start === demoStart) {
      this.row = existing;
    } else {
      this.row = { anchor_sim: demoStart, anchor_wall_ms: wall(), speed, paused: 0, demo_start: demoStart };
      this.save();
    }
  }

  private save() {
    this.db
      .prepare(
        `INSERT INTO clock (id, anchor_sim, anchor_wall_ms, speed, paused, demo_start) VALUES (1, @anchor_sim, @anchor_wall_ms, @speed, @paused, @demo_start)
         ON CONFLICT(id) DO UPDATE SET anchor_sim = excluded.anchor_sim, anchor_wall_ms = excluded.anchor_wall_ms, speed = excluded.speed, paused = excluded.paused, demo_start = excluded.demo_start`,
      )
      .run(this.row);
  }

  /** Simulated time in fractional epoch minutes. */
  exact(): number {
    if (this.row.paused) return this.row.anchor_sim;
    return this.row.anchor_sim + ((this.wall() - this.row.anchor_wall_ms) / 60_000) * this.row.speed;
  }

  /** Simulated time in whole epoch minutes. */
  now(): number {
    return Math.floor(this.exact());
  }

  get demoStart() {
    return this.row.demo_start;
  }

  state() {
    return { now: this.now(), exact: this.exact(), speed: this.row.speed, paused: !!this.row.paused, demoStart: this.row.demo_start };
  }

  /** Re-anchor so changes apply from the current simulated moment. */
  set(opts: { speed?: number; paused?: boolean; to?: number }) {
    const at = opts.to ?? this.exact();
    this.row = {
      ...this.row,
      anchor_sim: at,
      anchor_wall_ms: this.wall(),
      speed: opts.speed ?? this.row.speed,
      paused: opts.paused == null ? this.row.paused : opts.paused ? 1 : 0,
    };
    this.save();
  }

  /** Real seconds it takes for `minutes` of simulated time to pass. */
  wallSeconds(minutes: number) {
    return this.row.paused || this.row.speed <= 0 ? Infinity : (minutes * 60) / this.row.speed;
  }
}
