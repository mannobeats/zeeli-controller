import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { useFeedback } from '../../ui/feedback.tsx';

export const RULES_KEY = ['adguard-rules'];

/**
 * Changes to your own AdGuard rules. The change runs on the list as the router has it right now,
 * so two quick edits never overwrite each other, and the toast offers to put the old list back.
 */
export function useRuleEdit() {
  const { toast } = useFeedback();
  const edit = useWrite(
    async (change: (rules: string[]) => string[]) => {
      const before = await api.dns.userRules();
      await api.dns.setUserRules(change(before));
      return before;
    },
    [RULES_KEY],
  );
  const restore = useWrite((rules: string[]) => api.dns.setUserRules(rules), [RULES_KEY]);
  const apply = async (change: (rules: string[]) => string[], done: string) => {
    try {
      const before = await edit.mutateAsync(change);
      toast(done, () => restore.mutateAsync(before));
    } catch (e) {
      toast(`Couldn’t save the rule: ${errorMessage(e)}`);
    }
  };
  return { apply, busy: edit.isPending || restore.isPending };
}
