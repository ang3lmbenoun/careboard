import { useEffect, useState } from "react";

/** True once `busy` has stayed true for `afterMs`. Resets as soon as the work ends. */
export function useStillWorking(busy: boolean, afterMs = 12000) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const t = window.setTimeout(() => setSlow(true), afterMs);
    return () => window.clearTimeout(t);
  }, [busy, afterMs]);
  return slow;
}

export const STILL_WORKING = "Still working on it. Slow questions can take up to a minute.";
