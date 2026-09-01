import type { WebSocket } from 'ws';

export type WsMessage = Record<string, unknown>;

/**
 * WebSocket connection manager — a direct port of the FastAPI version.
 *
 * Two channels:
 *   - trip channel  (/ws/trip/{trip_id})     -> live seat/trip events for a trip
 *   - user channel  (/ws/notifications?token=) -> per-user notification push
 */
export class ConnectionManager {
  private readonly tripConns = new Map<number, Set<WebSocket>>();
  private readonly userConns = new Map<number, Set<WebSocket>>();

  // ---- lifecycle ---------------------------------------------------------

  connectTrip(websocket: WebSocket, tripId: number): void {
    const set = this.tripConns.get(tripId) ?? new Set<WebSocket>();
    set.add(websocket);
    this.tripConns.set(tripId, set);
  }

  connectUser(websocket: WebSocket, userId: number): void {
    const set = this.userConns.get(userId) ?? new Set<WebSocket>();
    set.add(websocket);
    this.userConns.set(userId, set);
  }

  disconnect(websocket: WebSocket): void {
    for (const set of this.tripConns.values()) set.delete(websocket);
    for (const set of this.userConns.values()) set.delete(websocket);
  }

  // ---- broadcast ---------------------------------------------------------

  broadcastTrip(tripId: number, message: WsMessage): void {
    const set = this.tripConns.get(tripId);
    if (!set) return;
    for (const ws of [...set]) {
      try {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
        else this.disconnect(ws);
      } catch {
        this.disconnect(ws);
      }
    }
  }

  /** Broadcast to every connected trip socket (compat with old callers). */
  broadcast(message: WsMessage): void {
    for (const tripId of [...this.tripConns.keys()]) {
      this.broadcastTrip(tripId, message);
    }
  }

  sendToUser(userId: number, message: WsMessage): void {
    const set = this.userConns.get(userId);
    if (!set) return;
    for (const ws of [...set]) {
      try {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
        else this.disconnect(ws);
      } catch {
        this.disconnect(ws);
      }
    }
  }
}

export const manager = new ConnectionManager();
