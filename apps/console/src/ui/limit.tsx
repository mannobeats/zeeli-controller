import { useState } from 'react';

/** How many rows a long list shows before it asks. */
export const STEP = 25;

/**
 * The first `step` rows of a list, and a footer to see more. Lists in the console stop at a
 * readable length instead of running down the page; filters are the way to find something.
 */
export function useLimit<T>(rows: T[], step = STEP) {
  const [limit, setLimit] = useState(step);
  return {
    shown: rows.slice(0, limit),
    more: <MoreRows shown={Math.min(limit, rows.length)} total={rows.length} step={step} setLimit={setLimit} />,
  };
}

function MoreRows({ shown, total, step, setLimit }: { shown: number; total: number; step: number; setLimit: (n: number) => void }) {
  if (total <= step) return null;
  const left = total - shown;
  return (
    <div className="more-rows">
      <span className="num">
        {shown} of {total}
      </span>
      {left > 0 ? (
        <>
          <button type="button" className="link" onClick={() => setLimit(shown + step)}>
            Show {Math.min(step, left)} more
          </button>
          {left > step ? (
            <button type="button" className="link" onClick={() => setLimit(total)}>
              Show all
            </button>
          ) : null}
        </>
      ) : (
        <button type="button" className="link" onClick={() => setLimit(step)}>
          Show fewer
        </button>
      )}
    </div>
  );
}
