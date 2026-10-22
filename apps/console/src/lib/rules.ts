/** Checks a rule's destination port: its format first, then that the protocol carries ports. Throws the message a rule sheet shows. */
export function checkRulePort(rule: { destPort: string; proto: string }, valid: (port: string) => boolean, problem: string) {
  if (!valid(rule.destPort)) throw new Error(problem);
  if (rule.destPort && !/tcp|udp/.test(rule.proto)) throw new Error('Ports only apply to TCP or UDP.');
}
