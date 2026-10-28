export interface NotificationHistory {
  id: string;
  title: string;
  recipient: string;
  recipientCount: number;
  date: string;
  type: "Maintenance" | "Reminder" | "Promotion" | "Information" | "Emergency" | "Approval" | "Reject";
}

export const notificationHistory: NotificationHistory[] = [];
