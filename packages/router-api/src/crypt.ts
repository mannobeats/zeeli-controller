// SHA-256 crypt ("$5$", Ulrich Drepper's spec), which the GL.iNet login challenge asks for.
const ITOA = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ORDER = [
  [0, 10, 20],
  [21, 1, 11],
  [12, 22, 2],
  [3, 13, 23],
  [24, 4, 14],
  [15, 25, 5],
  [6, 16, 26],
  [27, 7, 17],
  [18, 28, 8],
  [9, 19, 29],
] as const;
const ROUNDS = 5000;

const concat = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};
const sha = async (...parts: Uint8Array[]) => new Uint8Array(await crypto.subtle.digest('SHA-256', concat(parts)));
const repeat = (bytes: Uint8Array, length: number) => Uint8Array.from({ length }, (_, i) => bytes[i % bytes.length] ?? 0);
const b64 = (b2: number, b1: number, b0: number, n: number) => {
  let w = (b2 << 16) | (b1 << 8) | b0;
  let s = '';
  for (let i = 0; i < n; i++) {
    s += ITOA[w & 63];
    w >>= 6;
  }
  return s;
};

/** shaCrypt('pw', '$5$salt$') resolves to '$5$salt$<hash>'. */
export async function shaCrypt(password: string, setting: string): Promise<string> {
  const enc = new TextEncoder();
  const P = enc.encode(password);
  const S = enc.encode(setting.split('$')[2] ?? '').slice(0, 16);

  const B = await sha(P, S, P);
  const aParts = [P, S, repeat(B, P.length)];
  for (let n = P.length; n > 0; n >>= 1) aParts.push(n & 1 ? B : P);
  const A = await sha(...aParts);
  const Pp = repeat(await sha(...Array<Uint8Array>(P.length).fill(P)), P.length);
  const Sp = repeat(await sha(...Array<Uint8Array>(16 + (A[0] ?? 0)).fill(S)), S.length);

  let C = A;
  for (let i = 0; i < ROUNDS; i++) {
    const seq = [i & 1 ? Pp : C];
    if (i % 3) seq.push(Sp);
    if (i % 7) seq.push(Pp);
    seq.push(i & 1 ? C : Pp);
    C = await sha(...seq);
  }
  const at = (i: number) => C[i] ?? 0;
  const hash = ORDER.map(([a, b, c]) => b64(at(a), at(b), at(c), 4)).join('') + b64(0, at(31), at(30), 3);
  return `$5$${new TextDecoder().decode(S)}$${hash}`;
}

export const sha256Hex = async (text: string) =>
  [...(await sha(new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
