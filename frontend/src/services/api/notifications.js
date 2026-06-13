import { api } from './client.js';

export async function listNotifications() {
  // TODO(db): return api.get('/notifications');
  throw new Error('listNotifications: not yet implemented');
}

// TODO(mcp): implement real send via notification_service
export async function sendNotification(event) {
  throw new Error('sendNotification: not yet implemented — use notification_service on backend');
}
