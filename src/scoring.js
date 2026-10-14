// Scoring rules: +1 for every correct pick.
//   - each of the top 5 positions (P1..P5)
//   - P10
//   - each driver picked as a DNF who really did not finish
export const MAX_DNF_PICKS = 3;

// Set to false if drivers who did not start (DNS) should not count as DNF.
export const COUNT_DNS_AS_DNF = true;

// Builds a lookup for one race from its result rows.
export function buildResultLookup(rows) {
  const byPos = {};
  const dnf = new Set();
  for (const r of rows) {
    const text = String(r.pos_text ?? '');
    if (/^\d+$/.test(text)) byPos[Number(text)] = r.driver_id;
    else if (text === 'R' || (COUNT_DNS_AS_DNF && text === 'W')) dnf.add(r.driver_id);
  }
  return { byPos, dnf };
}

export function scorePrediction(pred, lookup) {
  const detail = {};
  let pts = 0;
  ['p1', 'p2', 'p3', 'p4', 'p5'].forEach((key, i) => {
    detail[key] = lookup.byPos[i + 1] === pred[key];
    if (detail[key]) pts++;
  });
  detail.p10 = lookup.byPos[10] === pred.p10;
  if (detail.p10) pts++;
  const dnfs = typeof pred.dnfs === 'string' ? JSON.parse(pred.dnfs || '[]') : pred.dnfs || [];
  detail.dnfs = dnfs.map((d) => lookup.dnf.has(d));
  pts += detail.dnfs.filter(Boolean).length;
  return { pts, detail };
}
