export interface AuditLog {
  id: number;
  action: string;
  administrator: string;
  target: string;
  timestamp: string;
  ipAddress: string;
}

export const auditLogs: AuditLog[] = [];
