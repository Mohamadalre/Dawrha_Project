export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

export const NotificationStatusDescription = {
  PENDING: 'Message was created and queued but not yet delivered.',
  SENT: 'Message was successfully delivered to Firebase and queued devices.',
  FAILED: 'Delivery failed and requires review or retry.',
};
