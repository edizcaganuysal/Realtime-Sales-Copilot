import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/**
 * Overrides the default IoAdapter to set destroyUpgrade: false on the
 * engine.io server.  Without this, engine.io calls socket.destroy() on every
 * WebSocket upgrade request whose path is not /socket.io — which kills the
 * Twilio /media-stream connection before our WsServer can handle it.
 */
export class CustomIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      destroyUpgrade: false,
      destroyUpgradeTimeout: 1000,
    } as ServerOptions);
  }
}
