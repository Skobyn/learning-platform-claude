import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { parse } from 'url';
import jwt from 'jsonwebtoken';

interface WebSocketConnection {
  ws: WebSocket;
  userId: string;
  rooms: Set<string>;
  lastActivity: Date;
}

interface Message {
  type: string;
  data: any;
  room?: string;
  userId?: string;
  timestamp: string;
}

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private connections = new Map<string, WebSocketConnection>();
  private rooms = new Map<string, Set<string>>(); // room -> set of connection IDs
  private heartbeatInterval: NodeJS.Timeout | null = null;

  initialize(port: number = 3001) {
    this.wss = new WebSocketServer({
      port,
      verifyClient: this.verifyClient.bind(this),
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.startHeartbeat();

    console.log(`WebSocket server running on port ${port}`);
  }

  private verifyClient(info: { origin: string; secure: boolean; req: IncomingMessage }): boolean {
    try {
      const url = parse(info.req.url || '', true);
      const token = url.query.token as string;

      if (!token) {
        return false;
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || 'secret') as any;

      // Store user info for later use
      (info.req as any).userId = decoded.sub || decoded.userId;

      return true;
    } catch (error) {
      console.error('WebSocket authentication failed:', error);
      return false;
    }
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage) {
    const userId = (req as any).userId;
    const connectionId = this.generateConnectionId();

    const connection: WebSocketConnection = {
      ws,
      userId,
      rooms: new Set(),
      lastActivity: new Date(),
    };

    this.connections.set(connectionId, connection);

    // Auto-join user to their personal room
    this.joinRoom(connectionId, `user:${userId}`);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as Message;
        this.handleMessage(connectionId, message);
      } catch (error) {
        console.error('Invalid message format:', error);
        this.sendError(connectionId, 'Invalid message format');
      }
    });

    ws.on('close', () => {
      this.handleDisconnection(connectionId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for user ${userId}:`, error);
      this.handleDisconnection(connectionId);
    });

    // Send welcome message
    this.sendToConnection(connectionId, {
      type: 'connection:established',
      data: { connectionId, userId },
      timestamp: new Date().toISOString(),
    });

    console.log(`User ${userId} connected (${connectionId})`);
  }

  private handleMessage(connectionId: string, message: Message) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.lastActivity = new Date();

    switch (message.type) {
      case 'room:join':
        this.joinRoom(connectionId, message.data.room);
        break;

      case 'room:leave':
        this.leaveRoom(connectionId, message.data.room);
        break;

      case 'discussion:typing':
        this.handleTypingIndicator(connectionId, message);
        break;

      case 'discussion:view':
        this.handleDiscussionView(connectionId, message);
        break;

      case 'study-group:activity':
        this.handleStudyGroupActivity(connectionId, message);
        break;

      case 'ping':
        this.sendToConnection(connectionId, {
          type: 'pong',
          data: { timestamp: new Date().toISOString() },
          timestamp: new Date().toISOString(),
        });
        break;

      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  private handleDisconnection(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Leave all rooms
    connection.rooms.forEach(room => {
      this.leaveRoom(connectionId, room);
    });

    this.connections.delete(connectionId);

    console.log(`User ${connection.userId} disconnected (${connectionId})`);
  }

  private joinRoom(connectionId: string, room: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.rooms.add(room);

    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }

    this.rooms.get(room)!.add(connectionId);

    this.sendToConnection(connectionId, {
      type: 'room:joined',
      data: { room },
      timestamp: new Date().toISOString(),
    });

    // Notify others in the room about the new member
    this.broadcastToRoom(room, {
      type: 'room:member_joined',
      data: { userId: connection.userId, room },
      timestamp: new Date().toISOString(),
    }, connectionId);
  }

  private leaveRoom(connectionId: string, room: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.rooms.delete(room);

    const roomConnections = this.rooms.get(room);
    if (roomConnections) {
      roomConnections.delete(connectionId);

      if (roomConnections.size === 0) {
        this.rooms.delete(room);
      } else {
        // Notify others in the room about the member leaving
        this.broadcastToRoom(room, {
          type: 'room:member_left',
          data: { userId: connection.userId, room },
          timestamp: new Date().toISOString(),
        });
      }
    }

    this.sendToConnection(connectionId, {
      type: 'room:left',
      data: { room },
      timestamp: new Date().toISOString(),
    });
  }

  private handleTypingIndicator(connectionId: string, message: Message) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    const { discussionId, isTyping } = message.data;
    const room = `discussion:${discussionId}`;

    this.broadcastToRoom(room, {
      type: 'discussion:typing',
      data: {
        userId: connection.userId,
        discussionId,
        isTyping,
      },
      timestamp: new Date().toISOString(),
    }, connectionId);
  }

  private handleDiscussionView(connectionId: string, message: Message) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    const { discussionId } = message.data;
    const room = `discussion:${discussionId}`;

    // Auto-join the discussion room
    this.joinRoom(connectionId, room);

    this.broadcastToRoom(room, {
      type: 'discussion:viewer_joined',
      data: {
        userId: connection.userId,
        discussionId,
      },
      timestamp: new Date().toISOString(),
    }, connectionId);
  }

  private handleStudyGroupActivity(connectionId: string, message: Message) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    const { groupId, activity } = message.data;
    const room = `study-group:${groupId}`;

    this.broadcastToRoom(room, {
      type: 'study-group:activity',
      data: {
        userId: connection.userId,
        groupId,
        activity,
      },
      timestamp: new Date().toISOString(),
    }, connectionId);
  }

  // Public methods for sending messages from other services
  public sendToUser(userId: string, message: Omit<Message, 'timestamp'>) {
    const room = `user:${userId}`;
    this.broadcastToRoom(room, {
      ...message,
      timestamp: new Date().toISOString(),
    });
  }

  public broadcastToDiscussion(discussionId: string, message: Omit<Message, 'timestamp'>) {
    const room = `discussion:${discussionId}`;
    this.broadcastToRoom(room, {
      ...message,
      timestamp: new Date().toISOString(),
    });
  }

  public broadcastToStudyGroup(groupId: string, message: Omit<Message, 'timestamp'>) {
    const room = `study-group:${groupId}`;
    this.broadcastToRoom(room, {
      ...message,
      timestamp: new Date().toISOString(),
    });
  }

  public broadcastToAll(message: Omit<Message, 'timestamp'>) {
    const fullMessage: Message = {
      ...message,
      timestamp: new Date().toISOString(),
    };

    this.connections.forEach((connection, connectionId) => {
      this.sendToConnection(connectionId, fullMessage);
    });
  }

  // Private helper methods
  private sendToConnection(connectionId: string, message: Message) {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      connection.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending message to connection:', error);
      this.handleDisconnection(connectionId);
    }
  }

  private broadcastToRoom(room: string, message: Message, excludeConnectionId?: string) {
    const roomConnections = this.rooms.get(room);
    if (!roomConnections) return;

    roomConnections.forEach(connectionId => {
      if (connectionId !== excludeConnectionId) {
        this.sendToConnection(connectionId, message);
      }
    });
  }

  private sendError(connectionId: string, error: string) {
    this.sendToConnection(connectionId, {
      type: 'error',
      data: { error },
      timestamp: new Date().toISOString(),
    });
  }

  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = new Date();
      const timeout = 5 * 60 * 1000; // 5 minutes

      this.connections.forEach((connection, connectionId) => {
        const timeSinceLastActivity = now.getTime() - connection.lastActivity.getTime();

        if (timeSinceLastActivity > timeout) {
          console.log(`Closing inactive connection: ${connectionId}`);
          connection.ws.close();
          this.handleDisconnection(connectionId);
        }
      });
    }, 60 * 1000); // Check every minute
  }

  public getStats() {
    return {
      connections: this.connections.size,
      rooms: this.rooms.size,
      roomDetails: Array.from(this.rooms.entries()).map(([room, connections]) => ({
        room,
        memberCount: connections.size,
      })),
    };
  }

  public shutdown() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.connections.forEach((connection) => {
      connection.ws.close();
    });

    if (this.wss) {
      this.wss.close();
    }

    console.log('WebSocket service shut down');
  }
}

export const webSocketService = new WebSocketService();

// Initialize WebSocket service if not in test environment
if (process.env.NODE_ENV !== 'test') {
  const port = parseInt(process.env.WS_PORT || '3001');
  webSocketService.initialize(port);
}