import { WebSocket, WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 3001);
const wss = new WebSocketServer({ port: PORT });
const rooms = new Map();

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function removeClient(ws) {
  const room = rooms.get(ws.roomId);
  if (!room) return;
  room.clients.delete(ws.clientId);
  if (ws.role === 'host') {
    for (const client of room.clients.values()) send(client, { type: 'room-closed', reason: 'O anfitrião encerrou a conexão.' });
    rooms.delete(ws.roomId);
  } else if (room.host) {
    send(room.host, { type: 'peer-left', peerId: ws.clientId });
  }
  if (room.clients.size === 0) rooms.delete(ws.roomId);
}

wss.on('connection', (ws) => {
  ws.clientId = randomUUID();
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      const roomId = String(msg.roomId || '').toUpperCase();
      const role = msg.role === 'host' ? 'host' : 'viewer';
      if (!/^[A-Z0-9]{6}$/.test(roomId)) return send(ws, { type: 'error', message: 'Código de sala inválido.' });
      let room = rooms.get(roomId);
      if (!room && role === 'viewer') return send(ws, { type: 'error', message: 'Essa sala não existe ou já foi encerrada.' });
      if (!room) { room = { host: null, clients: new Map() }; rooms.set(roomId, room); }
      if (role === 'host' && room.host) return send(ws, { type: 'error', message: 'Esta sala já possui um anfitrião.' });
      ws.roomId = roomId;
      ws.role = role;
      room.clients.set(ws.clientId, ws);
      if (role === 'host') {
        room.host = ws;
        send(ws, { type: 'joined', clientId: ws.clientId, role, viewers: room.clients.size - 1 });
      } else {
        if (!room.host) { room.clients.delete(ws.clientId); return send(ws, { type: 'error', message: 'O anfitrião ainda não está conectado.' }); }
        send(ws, { type: 'joined', clientId: ws.clientId, role });
        send(room.host, { type: 'viewer-joined', peerId: ws.clientId });
      }
      return;
    }

    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;
    if (['offer', 'answer', 'ice'].includes(msg.type) && msg.targetId) {
      const target = room.clients.get(msg.targetId);
      if (target) send(target, { ...msg, fromId: ws.clientId });
    }
  });
  ws.on('close', () => removeClient(ws));
  ws.on('error', () => removeClient(ws));
});

console.log(`Signaling server listening on ws://localhost:${PORT}`);
