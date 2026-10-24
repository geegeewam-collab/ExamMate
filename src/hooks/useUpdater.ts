import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { realClock } from '../lib/engine';
import { UpdateController, type UpdateSnapshot } from '../lib/update-controller';
import { checkForUpdate, snoozeStore, updatesSupported } from '../services/update-service';

export interface Updater {
  /** False on the website and in builds with no version: there is nothing to check. */
  supported: boolean;
  snap: UpdateSnapshot;
  checkNow(): Promise<void>;
  later(): void;
  started(): void;
  close(): void;
}

/** Looks for a new version when the app opens, when it returns to the front, and every few hours while it stays open. */
export function useUpdater(): Updater {
  const ref = useRef<UpdateController | null>(null);
  if (!ref.current) ref.current = new UpdateController(() => checkForUpdate(), realClock, snoozeStore);
  const ctl = ref.current;
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (!updatesSupported()) return;
    setSupported(true);
    ctl.start();
    const on = () => {
      if (document.visibilityState === 'visible') ctl.foreground();
    };
    document.addEventListener('visibilitychange', on);
    return () => {
      document.removeEventListener('visibilitychange', on);
      ctl.stop();
    };
  }, [ctl]);

  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot);
  return {
    supported, snap,
    checkNow: () => ctl.checkNow(),
    later: () => ctl.later(),
    started: () => ctl.started(),
    close: () => ctl.close(),
  };
}
