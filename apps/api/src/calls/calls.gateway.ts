import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/calls', cors: { origin: '*' } })
export class CallsGateway {
  @WebSocketServer()
  server!: Server;

  @SubscribeMessage('join')
  handleJoin(@MessageBody() callId: string, @ConnectedSocket() client: Socket) {
    client.join(callId);
  }

  @SubscribeMessage('leave')
  handleLeave(@MessageBody() callId: string, @ConnectedSocket() client: Socket) {
    client.leave(callId);
  }

  emitToCall(callId: string, event: string, data: unknown) {
    this.server.to(callId).emit(event, data);
  }
}
