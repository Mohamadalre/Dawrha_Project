export class SendNotificationEvent {
  constructor(
    public userId: string,
    public title: string,
    public body: string,
    public data?: Record<string, any>,
  ) {}
}