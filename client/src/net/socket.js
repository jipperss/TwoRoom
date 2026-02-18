import { io } from 'socket.io-client';

export function createSocket() {
  return io({
    transports: ['polling', 'websocket'],
    reconnection: false
  });
}
