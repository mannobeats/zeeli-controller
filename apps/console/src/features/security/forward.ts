const portOrRange = (v: string) => /^\d{1,5}(-\d{1,5})?$/.test(v) && v.split('-').every((p) => Number(p) >= 1 && Number(p) <= 65_535);
const isRange = (p: string) => p.includes('-');
const span = (p: string) => {
  const [from = 0, to = from] = p.split('-').map(Number);
  return to - from;
};

/** Checks a port forward's outside and device ports. Throws the message the sheet shows. */
export function checkForwardPorts(outside: string, inside: string) {
  if (!portOrRange(outside) || !portOrRange(inside)) throw new Error('Ports must be 1 to 65535, or a range like 8000-8010.');
  if (isRange(outside) && isRange(inside) && span(outside) !== span(inside)) throw new Error('Both port ranges must be the same size.');
  if (!isRange(outside) && isRange(inside)) throw new Error('A single outside port can’t go to a range.');
}
