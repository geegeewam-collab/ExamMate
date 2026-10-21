import { Device } from '@capacitor/device';
import { Preferences } from '@capacitor/preferences';

export interface LicenseStatus {
  isValid: boolean;
  token?: string;
  error?: string;
}

export class LicenseService {
  private static BASE_URL = 'https://api.exammate.com'; // Placeholder for the actual license server

  static async getDeviceId(): Promise<string> {
    const id = await Device.getId();
    return (id as any).uuid || id;
  }

  static async validateLicense(licenseKey: string): Promise<LicenseStatus> {
    try {
      const deviceId = await this.getDeviceId();

      const response = await fetch(`${this.BASE_URL}/api/license/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey, deviceId }),
      });

      if (!response.ok) {
        const data = await response.json();
        return { isValid: false, error: data.error || 'Invalid license key' };
      }

      const data = await response.json();
      // Save binding token securely
      await Preferences.set({
        key: 'binding_token',
        value: data.token,
      });

      return { isValid: true, token: data.token };
    } catch (error) {
      return { isValid: false, error: 'Network error. Please check your connection.' };
    }
  }

  static async checkLocalBinding(): Promise<boolean> {
    const { value } = await Preferences.get({ key: 'binding_token' });
    if (!value) return false;

    try {
      const deviceId = await this.getDeviceId();
      const response = await fetch(`${this.BASE_URL}/api/license/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: value, deviceId }),
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
