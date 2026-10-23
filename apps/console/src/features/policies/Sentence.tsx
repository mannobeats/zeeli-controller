import { type Draft, type Names, sentence } from './sentence.ts';

/** A policy as the sentence it reads as; the parts that are choices are bold. */
export function Sentence({ policy, names, now }: { policy: Draft; names: Names; now?: number }) {
  return <span className="sentence">{sentence(policy, names, now).map((s) => (s.strong ? <b key={s.id}>{s.text}</b> : s.text))}</span>;
}
