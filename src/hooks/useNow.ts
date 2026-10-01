import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { serverNowQuery } from "@/lib/api";

/** The current time, re-read every `intervalMs`. Copied from grand-slam-gm/src/hooks/useNow.ts. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * The server's current time, ticking. Locks are the server's decision; countdowns use the server's
 * clock so a phone set to the wrong time (or the local simulated clock) still shows the truth.
 */
export function useServerNow(intervalMs = 1_000): number {
  const now = useNow(intervalMs);
  const { data } = useQuery(serverNowQuery);
  return now + (data?.offsetMs ?? 0);
}
