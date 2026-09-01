import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth.js';
import { HttpError } from '../http-error.js';
import { parseId } from '../util.js';

export function registerNotificationsRoutes(app: FastifyInstance): void {
  app.get('/api/notifications', { preHandler: [authenticate] }, async (request) => {
    const user = request.user!;
    const query = request.query as { limit?: string };
    const limit = Number(query.limit ?? '30');

    const rows = await request.db.all(
      `SELECT id, kind, title, body, payload, read, created_at
       FROM notifications
       WHERE user_id = :uid
       ORDER BY created_at DESC, id DESC
       LIMIT :limit;`,
      { uid: user.id, limit },
    );
    const unread = (await request.db.value(
      'SELECT count(*) FROM notifications WHERE user_id = :uid AND read = false;',
      { uid: user.id },
    )) as number;
    return { notifications: rows, unread: Number(unread) };
  });

  app.post('/api/notifications/:notif_id/read', { preHandler: [authenticate] }, async (request) => {
    const notifId = parseId((request.params as { notif_id?: string }).notif_id);
    const db = request.db;
    const user = request.user!;

    const row = await db.first('SELECT id, user_id FROM notifications WHERE id = :id;', {
      id: notifId,
    });
    if (!row) throw new HttpError(404, 'Notification not found.');
    if (row.user_id !== user.id) throw new HttpError(403, 'Not your notification.');

    await db.execute('UPDATE notifications SET read = true WHERE id = :id;', { id: notifId });
    await db.commit();
    return { read: true };
  });

  app.post('/api/notifications/read-all', { preHandler: [authenticate] }, async (request) => {
    const user = request.user!;
    await request.db.execute(
      'UPDATE notifications SET read = true WHERE user_id = :uid AND read = false;',
      { uid: user.id },
    );
    await request.db.commit();
    return { read_all: true };
  });
}
