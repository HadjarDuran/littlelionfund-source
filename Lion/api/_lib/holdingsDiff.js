// Diffs an old vs. new holdings array into transaction-log events, so the
// portfolio's actual composition over time can eventually be reconstructed
// instead of just having "current holdings" overwritten in place. Doesn't
// retroactively invent history from before this existed — only what
// changes from here forward gets logged.
function diffHoldings(oldArr, newArr) {
  const oldByTicker = new Map((oldArr || []).map(h => [h.t, h]));
  const newByTicker = new Map((newArr || []).map(h => [h.t, h]));
  const events = [];

  for (const [ticker, h] of newByTicker) {
    if (!oldByTicker.has(ticker)) {
      events.push({ action: 'add', ticker, sh: h.sh, ac: h.ac, s: h.s });
    }
  }
  for (const [ticker, h] of oldByTicker) {
    if (!newByTicker.has(ticker)) {
      events.push({ action: 'remove', ticker, sh: h.sh, ac: h.ac, s: h.s });
    }
  }
  for (const [ticker, oldH] of oldByTicker) {
    const newH = newByTicker.get(ticker);
    if (!newH) continue;
    if (oldH.sh !== newH.sh || oldH.ac !== newH.ac || oldH.s !== newH.s) {
      events.push({
        action: 'edit', ticker,
        from: { sh: oldH.sh, ac: oldH.ac, s: oldH.s },
        to: { sh: newH.sh, ac: newH.ac, s: newH.s }
      });
    }
  }
  return events;
}

module.exports = { diffHoldings };
