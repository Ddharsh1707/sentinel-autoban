// All times in Sentinel are milliseconds since the Unix epoch (UTC).
// Tests swap in a fake clock so expiry can be checked to the exact millisecond.

export function systemClock() {
  return { now: () => Date.now() };
}

export function fakeClock(start = Date.UTC(2026, 9, 5, 18, 0, 0)) {
  let t = start;
  return {
    now: () => t,
    set: (ms) => {
      t = ms;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}
