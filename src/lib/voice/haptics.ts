import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const safe = (fn: () => Promise<unknown>) => { try { void fn().catch(() => undefined); } catch { /* no haptics on this device */ } };

export const haptics = {
  start: () => safe(() => Haptics.impact({ style: ImpactStyle.Medium })),
  thinking: () => safe(() => Haptics.vibrate({ duration: 50 })),
  finish: () => safe(() => Haptics.notification({ type: NotificationType.Success })),
  error: () => safe(async () => {
    await Haptics.impact({ style: ImpactStyle.Heavy });
    setTimeout(() => safe(() => Haptics.impact({ style: ImpactStyle.Heavy })), 100);
  }),
};
