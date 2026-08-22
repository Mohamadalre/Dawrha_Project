import { Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { RedisService } from '@src/core/redis/redis.service';
import { Role } from '@src/user/enums/role.enum';
import { CoverageService } from '../services/coverage.service';
import { DISPATCH_REDIS } from '../constants/dispatch.constants';

interface SocketUser {
  id: string;
  role: Role;
}

interface NearbySubscription {
  lat: number;
  lng: number;
  radiusKm: number;
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
export class DispatchGatewayEvents implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('DISPATCH_SOCKET');

  @WebSocketServer()
  server: Server;

  /** userId → socket id set (a user may have multiple tabs) */
  private readonly userSockets = new Map<string, Set<string>>();

  /** socketId → nearby subscription params (user is watching nearby drivers) */
  private readonly nearbySubscriptions = new Map<string, NearbySubscription>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly coverageService: CoverageService,
    private readonly eventEmitter: EventEmitter2,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const user = await this.authenticate(client);
      client.data.user = user;
      if (user.role === Role.COLLECTOR) {
        await client.join(this.driverRoom(user.id));
      }
      if (user.role === Role.CITIZEN) {
        await client.join(this.userRoom(user.id));
        const sockets = this.userSockets.get(user.id) ?? new Set<string>();
        sockets.add(client.id);
        this.userSockets.set(user.id, sockets);
      }
      this.logger.log(`Client connected: ${client.id} (${user.role})`);
    } catch (error) {
      this.logger.warn(`Rejected socket ${client.id}: ${(error as Error).message}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const user: SocketUser | undefined = client.data.user;
    this.nearbySubscriptions.delete(client.id);
    if (user?.role === Role.CITIZEN) {
      const sockets = this.userSockets.get(user.id);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) this.userSockets.delete(user.id);
      }
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

  @SubscribeMessage('user:subscribe_request')
  async onUserSubscribeRequest(
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

  @SubscribeMessage('user:nearby_drivers')
  async onNearbyDrivers(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat?: number; lng?: number; radius_km?: number },
  ) {
    const user: SocketUser | undefined = client.data.user;
    if (!user) return { status: 'error', message: 'Unauthenticated' };
    if (user.role !== Role.CITIZEN) return { status: 'error', message: 'Forbidden' };
    if (data?.lat == null || data?.lng == null) {
      return { status: 'error', message: 'lat and lng are required' };
    }

    const radiusKm = data.radius_km ?? 10;
    this.nearbySubscriptions.set(client.id, { lat: data.lat, lng: data.lng, radiusKm });

    const zones = await this.coverageService.findNearbyZones(data.lat, data.lng, radiusKm);
    return { status: 'ok', zones };
  }

  @SubscribeMessage('user:unsubscribe_nearby')
  async onUnsubscribeNearby(@ConnectedSocket() client: Socket) {
    this.nearbySubscriptions.delete(client.id);
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

  announceTourStarted(driverId: string, payload: unknown): void {
    this.server?.to(this.driverRoom(driverId)).emit('driver:tour_started', payload);
  }

  announceTourCompleted(driverId: string, payload: unknown): void {
    this.server?.to(this.driverRoom(driverId)).emit('driver:tour_completed', payload);
  }

  announceToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(this.userRoom(userId)).emit(event, payload);
  }

  /**
   * Re-push nearby drivers to all users who are actively watching.
   * Call this when a driver's availability changes (accepts/rejects request,
   * finishes tour, becomes idle, etc.).
   */
  async pushNearbyDriversUpdate(): Promise<void> {
    for (const [socketId, sub] of this.nearbySubscriptions) {
      try {
        const zones = await this.coverageService.findNearbyZones(sub.lat, sub.lng, sub.radiusKm);
        this.server?.to(socketId).emit('user:nearby_update', { zones });
      } catch {
        // socket may have disconnected — will be cleaned up on disconnect
      }
    }
  }

  @OnEvent('collection.driver.freed')
  async onDriverFreed(): Promise<void> {
    await this.pushNearbyDriversUpdate();
  }

  @OnEvent('truck.location.updated')
  async onTruckLocationUpdated(payload: { truckId?: string; lat?: number; lng?: number; heading?: number | null }): Promise<void> {
    await this.pushNearbyDriversUpdate();

    // Forward GPS to users tracking requests assigned to this truck.
    if (payload.truckId && payload.lat != null && payload.lng != null) {
      try {
        const requestIds = await this.redis.smembers(
          DISPATCH_REDIS.truckRequestsKey(payload.truckId),
        );
        for (const requestId of requestIds) {
          this.server?.to(this.requestRoom(requestId)).emit('request:driver_location', {
            request_id: requestId,
            truck_id: payload.truckId,
            lat: payload.lat,
            lng: payload.lng,
            heading: payload.heading ?? null,
            updated_at: new Date(),
          });
        }
      } catch {
        // Redis read failure must not crash the gateway.
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private driverRoom(accountId: string): string {
    return `driver:${accountId}`;
  }

  private userRoom(userId: string): string {
    return `user:${userId}`;
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