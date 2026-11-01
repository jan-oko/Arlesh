import { useCallback, useEffect, useRef, useState } from "react";
import { errorReason, pairPoll, pairStart } from "@/api/devices";
import { getErrorMessage } from "@/api/errors";

/** How often the device asks whether its PIN was approved. */
export const POLL_MS = 5000;

/** Reasons after which the PIN can never be approved, so polling stops. */
const FINAL_REASONS: readonly string[] = ["unknown_pairing", "pin_invalidated"];

export type PairingState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "waiting"; pin: string }
  | { phase: "failed"; message: string; reason: string | null };

interface Session {
  url: string;
  id: string;
  pin: string;
}

/**
 * This device's side of pairing: asks the server for a PIN, then polls every few seconds until
 * the PIN is approved, and hands the token that comes with the approval, and the server's URL, to `onApproved`, once.
 * A refusal that ends the request (it lapsed, was used or was invalidated) stops the polling; any
 * other failure does not, since the phone may simply be changing network.
 */
export function usePairing(onApproved: (token: string, url: string) => void | Promise<void>) {
  const [state, setState] = useState<PairingState>({ phase: "idle" });
  const [session, setSession] = useState<Session | null>(null);
  const approved = useRef(onApproved);
  useEffect(() => { approved.current = onApproved; });

  useEffect(() => {
    if (session === null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fail = (error: unknown) => {
      setSession(null);
      setState({ phase: "failed", message: getErrorMessage(error), reason: errorReason(error) });
    };
    const tick = async () => {
      let token: string | null = null;
      try {
        const polled = await pairPoll(session.url, session.id, session.pin);
        if (polled.status === "approved") token = polled.token;
      } catch (error: unknown) {
        if (stopped) return;
        const reason = errorReason(error);
        if (reason !== null && FINAL_REASONS.includes(reason)) return fail(error);
        // Anything else (the network, a busy server) is tried again at the next poll.
      }
      if (stopped) return;
      if (token === null) return schedule();
      setSession(null);
      try {
        await approved.current(token, session.url);
      } catch (error: unknown) {
        fail(error);
      }
    };
    const schedule = () => { timer = setTimeout(() => { void tick(); }, POLL_MS); };
    schedule();

    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [session]);

  const start = useCallback(async (url: string, name: string) => {
    setState({ phase: "starting" });
    try {
      const started = await pairStart(url, name);
      setState({ phase: "waiting", pin: started.pin });
      setSession({ url, id: started.id, pin: started.pin });
    } catch (error: unknown) {
      setState({ phase: "failed", message: getErrorMessage(error), reason: errorReason(error) });
    }
  }, []);

  const cancel = useCallback(() => {
    setSession(null);
    setState({ phase: "idle" });
  }, []);

  return { state, start, cancel };
}
