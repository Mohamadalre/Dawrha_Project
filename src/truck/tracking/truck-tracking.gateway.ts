import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Server, Socket } from 'socket.io';
import { RedisService } from '@src/core/redis/redis.service';
import { Role } from '@src/user/enums/role.enum';
import { TruckTrackingService } from './truck-tracking.service';
import { TruckLocationDto } from './dto/truck-location.dto';
import { StopReason } from './enums/stop-reason.enum';

interface SocketUser {
  id: string;
  role: Role;
}

/**
 * Real-time truck tracking gateway (Socket.IO, namespace `/tracking`).
 *
 * Flow:
 *  - The driver app (COLLECTOR) emits `truck:location` with {truckId, lat, lng}.
 *    Coordinates are persisted in Redis and broadcast to subscribers.
 *  - The system admin (ADMIN) emits `truck:subscribe` {truckId} to join that
 *    truck's room and receive live `truck:location` events, or `admin:subscribeAll`
 *    to receive every truck's updates.
 *
 * Every connection is authenticated via JWT in the handshake
 * (`auth.token`, `?token=`, or the Authorization header).
 */
@WebSocketGateway({
  namespace: '/tracking',
  cors: { origin: '*' },
})
export class TruckTrackingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger('TRUCK_TRACKING');

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly tracking: TruckTrackingService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Connection / auth
  // ---------------------------------------------------------------------------
  async handleConnection(client: Socket): Promise<void> {
    try {
      const user = await this.authenticate(client);
      client.data.user = user;
      this.logger.log(`Client connected: ${client.id} (user ${user.id}, ${user.role})`);
    } catch (error) {
      this.logger.warn(`Rejected socket ${client.id}: ${(error as Error).message}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
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

  /**
   * When a driver's socket drops, persist the truck's last position to the DB and
   * notify subscribers that the truck has stopped.
   */
  async handleDisconnect(client: Socket): Promise<void> {
    const user: SocketUser | undefined = client.data.user;
    const truckId: string | undefined = client.data.truckId;
    if (user?.role !== Role.COLLECTOR || !truckId) return;

    const log = await this.tracking.finalizeStop(truckId, StopReason.DRIVER_DISCONNECT);
    this.emitStopped(truckId, StopReason.DRIVER_DISCONNECT, log);
    this.logger.log(`Driver ${user.id} disconnected; finalised truck ${truckId}`);
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

  // ---------------------------------------------------------------------------
  // Driver → server: publish a position
  // ---------------------------------------------------------------------------
  @SubscribeMessage('truck:location')
  async onLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const user: SocketUser | undefined = client.data.user;
    if (!user) return { status: 'error', message: 'Unauthenticated' };

    const dto = plainToInstance(TruckLocationDto, data);
    const errors = await validate(dto, { whitelist: true });
    if (errors.length) return { status: 'error', message: 'Invalid location payload' };

    // Authorisation AND liveness in one gate: a collector may report ONLY while
    // actively operating this truck — i.e. an OPEN handover exists (he pressed
    // "pick up"). A truck that is merely assigned but not yet picked up is not
    // tracked, which is the whole point: tracking runs only when the driver has
    // received/started the truck. Admins may report on behalf of any truck.
    if (user.role === Role.COLLECTOR) {
      const holding = await this.tracking.hasActiveHandover(user.id, dto.truckId);
      if (!holding) {
        return {
          status: 'error',
          message: 'Pick up the truck before tracking starts',
        };
      }
    } else if (user.role !== Role.ADMIN) {
      return { status: 'error', message: 'Forbidden' };
    }

    // Remember which truck this socket reports for, so a disconnect can finalise it.
    client.data.truckId = dto.truckId;

    const stored = await this.tracking.saveLocation(dto, user.id);
    this.server.to(this.room(dto.truckId)).emit('truck:location', stored);
    this.server.to('admins').emit('truck:location', stored);

    // The dispatch engine listens for this and re-elects the oldest queued
    // request (throttled per driver) so a driver's fresh position reaches the
    // scores without anyone polling Redis.
    if (user.role === Role.COLLECTOR) {
      this.eventEmitter.emit('truck.location.updated', {
        truckId: dto.truckId,
        driverId: user.id,
        lat: dto.lat,
        lng: dto.lng,
        heading: dto.heading,
      });
    }
    return { status: 'ok' };
  }

  /**
   * Driver/admin explicitly ends the trip → persist the last position to the DB
   * and notify subscribers.
   */
  @SubscribeMessage('truck:stop')
  async onStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { truckId?: string },
  ) {
    const user: SocketUser | undefined = client.data.user;
    if (!user) return { status: 'error', message: 'Unauthenticated' };

    const truckId = data?.truckId ?? client.data.truckId;
    if (!truckId) return { status: 'error', message: 'truckId is required' };

    if (user.role === Role.COLLECTOR) {
      const isDriver = await this.tracking.isDriverOfTruck(user.id, truckId);
      if (!isDriver) return { status: 'error', message: 'Not assigned to this truck' };
    } else if (user.role !== Role.ADMIN) {
      return { status: 'error', message: 'Forbidden' };
    }

    const log = await this.tracking.finalizeStop(truckId, StopReason.MANUAL_STOP);
    this.emitStopped(truckId, StopReason.MANUAL_STOP, log);
    return { status: 'ok', savedLocation: log };
  }

  private emitStopped(truckId: string, reason: StopReason, log: unknown): void {
    const payload = { truckId, reason, location: log };
    this.server?.to(this.room(truckId)).emit('truck:stopped', payload);
    this.server?.to('admins').emit('truck:stopped', payload);
  }

  // ---------------------------------------------------------------------------
  // Session boundaries, driven by the handover flow (pickup / dropoff)
  // ---------------------------------------------------------------------------
  /**
   * The driver picked the truck up: tracking is now live for it. Tell the admin
   * dashboards so a truck appears on the map the moment its session starts, even
   * before the first GPS ping arrives.
   */
  announceSessionStarted(info: {
    truckId: string;
    driverId?: string | null;
    plateNumber?: string | null;
  }): void {
    this.server?.to('admins').emit('truck:session', { ...info, status: 'started' });
  }

  /**
   * The driver handed the truck back: end the live session. Persists the last
   * known position as a stop and notifies subscribers the truck is no longer
   * tracked. Safe to call even if the truck never emitted a location.
   */
  async endSession(truckId: string, reason: StopReason): Promise<void> {
    const log = await this.tracking.finalizeStop(truckId, reason);
    this.emitStopped(truckId, reason, log);
  }

  // ---------------------------------------------------------------------------
  // Admin → server: subscribe to a truck / all trucks
  // ---------------------------------------------------------------------------
  @SubscribeMessage('truck:subscribe')
  async onSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { truckId?: string },
  ) {
    const user: SocketUser | undefined = client.data.user;
    if (user?.role !== Role.ADMIN) return { status: 'error', message: 'Forbidden' };
    if (!data?.truckId) return { status: 'error', message: 'truckId is required' };

    await client.join(this.room(data.truckId));
    const lastKnown = await this.tracking.getLocation(data.truckId);
    return { status: 'ok', location: lastKnown };
  }

  @SubscribeMessage('truck:unsubscribe')
  async onUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { truckId?: string },
  ) {
    if (data?.truckId) await client.leave(this.room(data.truckId));
    return { status: 'ok' };
  }

  @SubscribeMessage('admin:subscribeAll')
  async onSubscribeAll(@ConnectedSocket() client: Socket) {
    const user: SocketUser | undefined = client.data.user;
    if (user?.role !== Role.ADMIN) return { status: 'error', message: 'Forbidden' };

    await client.join('admins');
    const active = await this.tracking.getActiveTrucks();
    return { status: 'ok', active };
  }

  private room(truckId: string): string {
    return `truck:${truckId}`;
  }
}
