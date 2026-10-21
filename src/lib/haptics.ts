import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export const HapticPatterns = {
  triggerStart: async () => {
    await Haptics.impact({ style: ImpactStyle.Medium });
  },
  aiThinking: async () => {
    await Haptics.vibrate({ duration: 50 });
  },
  aiFinish: async () => {
    await Haptics.notification({ type: NotificationType.Success });
  },
  error: async () => {
    await Haptics.impact({ style: ImpactStyle.Heavy });
    setTimeout(() => Haptics.impact({ style: ImpactStyle.Heavy }), 100);
    setTimeout(() => Haptics.impact({ style: ImpactStyle.Heavy }), 200);
  }
};
