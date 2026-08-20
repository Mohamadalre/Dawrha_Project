import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RedisService } from '@src/core/redis/redis.service';
import { Role } from '@src/user/enums/role.enum';

interface SocketUser {
  id: string;
  role: Role;
}

/**
 * Real-time collection events gateway (Socket.IO, namespace `/collection`).
 *
 * Rooms:
 *  - every COLLECTOR joins `driver:{accountId}` on connect — the dispatch
 *    engine announces offers there (`request:assigned`),
 *  - producers subscribe to `request:{requestId}` to follow their request,
 *  - admins may join the `admins` room for `request:needs_admin` alerts.
 *
 * The gateway is a dumb bus: all events are announced by the dispatch engine
 * through this class; nobody else may emit onto this namespace.
 */
@WebSocketGateway({
  namespace: '/collection',
  cors: { origin: '*' },
})
export class DispatchGatewayEvents implements OnGatewayConnection {
  private readonly logger = new Logger('DISPATCH_SOCKET');

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const user = await this.authenticate(client);
      client.data.user = user;
      if (user.role === Role.COLLECTOR) {
        await client.join(this.driverRoom(user.id));
      }
      this.logger.log(`Client connected: ${client.id} (${user.role})`);
    } catch (error) {
      this.logger.warn(`Rejected socket ${client.id}: ${(error as Error).message}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  // ---------------------------------------------------------------------------
  // Producer / admin subscriptions
  // ---------------------------------------------------------------------------
  @SubscribeMessage('collection:subscribe')
  async onSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { requestId?: string },
  ) {
    const user: SocketUser | undefined = client.data.user;
    if (!user) return { status: 'error', message: 'Unauthenticated' };
    if (!data?.requestId) {
      return { status: 'error', message: 'requestId is required' };
    }
    await client.join(this.requestRoom(data.requestId));
    return { status: 'ok' };
  }

  @SubscribeMessage('collection:unsubscribe')
  async onUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { requestId?: string },
  ) {
    if (data?.requestId) await client.leave(this.requestRoom(data.requestId));
    return { status: 'ok' };
  }

  @SubscribeMessage('collection:subscribeAll')
  async onSubscribeAll(@ConnectedSocket() client: Socket) {
    const user: SocketUser | undefined = client.data.user;
    if (user?.role !== Role.ADMIN) return { status: 'error', message: 'Forbidden' };
    await client.join('admins');
    return { status: 'ok' };
  }

  // ---------------------------------------------------------------------------
  // Engine -> rooms
  // ---------------------------------------------------------------------------
  announceToDriver(accountId: string, event: string, payload: unknown): void {
    this.server?.to(this.driverRoom(accountId)).emit(event, payload);
  }

  announceToRequest(requestId: string, event: string, payload: unknown): void {
    this.server?.to(this.requestRoom(requestId)).emit(event, payload);
  }

  announceToAdmins(event: string, payload: unknown): void {
    this.server?.to('admins').emit(event, payload);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private driverRoom(accountId: string): string {
    return `driver:${accountId}`;
  }

  private requestRoom(requestId: string): string {
    return `request:${requestId}`;
  }

  private async authenticate(client: Socket): Promise<SocketUser> {
    const token = this.extractToken(client);
    if (!token) throw new Error('Missing token');

    const payload = await this.jwtService.verifyAsync(token, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
    });

    const userId = payload.id || payload.sub;
    if (!userId) throw new Error('Invalid token payload');

    const blacklisted = await this.redisService.getRedisByKey(`blackListToken:${userId}`);
    if (blacklisted) throw new Error('Token invalidated');

    return { id: userId, role: payload.role };
  }

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth?.token as string | undefined;
    if (auth) return auth.replace(/^Bearer\s+/i, '');

    const query = client.handshake.query?.token;
    if (typeof query === 'string' && query) return query;

    const header = client.handshake.headers?.authorization;
    if (header) return header.replace(/^Bearer\s+/i, '');

    return null;
  }
}