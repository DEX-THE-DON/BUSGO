"""WebSocket connection manager for BUSGO.

Two channels:
  - trip channel  (/ws/trip/{trip_id})     -> live seat/trip events for a trip
  - user channel  (/ws/notifications?token=) -> per-user notification push
"""
from collections import defaultdict
from typing import Dict, List

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self._trip_conns: Dict[int, List[WebSocket]] = defaultdict(list)
        self._user_conns: Dict[int, List[WebSocket]] = defaultdict(list)

    # ---- lifecycle -----------------------------------------------------------
    async def connect_trip(self, websocket: WebSocket, trip_id: int) -> None:
        await websocket.accept()
        self._trip_conns[trip_id].append(websocket)

    async def connect_user(self, websocket: WebSocket, user_id: int) -> None:
        await websocket.accept()
        self._user_conns[user_id].append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        for trip_id, conns in self._trip_conns.items():
            if websocket in conns:
                conns.remove(websocket)
        for user_id, conns in self._user_conns.items():
            if websocket in conns:
                conns.remove(websocket)

    # ---- broadcast -----------------------------------------------------------
    async def broadcast_trip(self, trip_id: int, message: dict) -> None:
        for ws in list(self._trip_conns.get(trip_id, [])):
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(ws)

    async def broadcast(self, message: dict) -> None:
        """Broadcast to every connected trip socket (compat with old callers)."""
        for conns in list(self._trip_conns.values()):
            for ws in list(conns):
                try:
                    await ws.send_json(message)
                except Exception:
                    self.disconnect(ws)

    async def send_to_user(self, user_id: int, message: dict) -> None:
        for ws in list(self._user_conns.get(user_id, [])):
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(ws)


manager = ConnectionManager()
