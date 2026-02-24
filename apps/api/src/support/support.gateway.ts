import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/support', cors: { origin: '*' } })
export class SupportGateway {
  @WebSocketServer()
  server!: Server;

  @SubscribeMessage('join')
  handleJoin(@MessageBody() sessionId: string, @ConnectedSocket() client: Socket) {
    client.join(sessionId);
  }

  @SubscribeMessage('leave')
  handleLeave(@MessageBody() sessionId: string, @ConnectedSocket() client: Socket) {
    client.leave(sessionId);
  }

  emitToSession(sessionId: string, event: string, data: unknown) {
    this.server.to(sessionId).emit(event, data);
  }
}
