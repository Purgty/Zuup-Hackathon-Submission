/**
 * INotificationService — Port for push notifications.
 *
 * INJECTION POINT: Swap MockNotificationService → FirebaseNotificationService
 * by setting NOTIFICATION_ADAPTER=firebase in your .env file.
 */
export interface INotificationService {
  /**
   * Sends a reroute instruction to a driver's mobile device.
   * In production: Firebase Cloud Messaging (FCM) push notification.
   * In mock: logs to console and emits an internal event.
   */
  sendDriverAlert(
    driverId: string,
    title: string,
    message: string,
    data?: Record<string, string>
  ): Promise<boolean>;

  /**
   * Sends a service disruption or status update to a passenger.
   * In production: FCM push to passenger app.
   * In mock: no-op (passenger app not built in Phase 1).
   */
  sendPassengerAlert(
    deviceId: string,
    title: string,
    message: string
  ): Promise<boolean>;
}
