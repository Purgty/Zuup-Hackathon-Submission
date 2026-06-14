import type { INotificationService } from '../../interfaces/INotificationService';

/**
 * MockNotificationService — Logs push notifications to the console.
 * No Firebase account needed. No external dependencies.
 *
 * Replace with FirebaseNotificationService for real push delivery.
 */
export class MockNotificationService implements INotificationService {
  async sendDriverAlert(
    driverId: string,
    title: string,
    message: string,
    data?: Record<string, string>
  ): Promise<boolean> {
    console.log(
      `\n📱 [PUSH → Driver ${driverId}] ${title}\n   ${message}`,
      data ? `\n   Data: ${JSON.stringify(data)}` : ''
    );
    return true;
  }

  async sendPassengerAlert(
    deviceId: string,
    title: string,
    message: string
  ): Promise<boolean> {
    console.log(`📲 [PUSH → Passenger ${deviceId.slice(0, 8)}] ${title}: ${message}`);
    return true;
  }
}
