import { Server } from 'socket.io';
import logger from './logger/apiLogger.js';

let io;

export const initSocket = (server) => {
    const envOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [];
    const allowedOrigins = [
        ...envOrigins,
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:8080',
        'http://localhost:8081', 
        'http://localhost:8082',
    ];

    io = new Server(server, {
        cors: {
            origin: allowedOrigins,
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    io.on('connection', (socket) => {
        logger.info(`[Socket] Client connected: ${socket.id}`);

        socket.on('join_admin_room', () => {
            socket.join('admin_notifications');
            logger.info(`[Socket] Client ${socket.id} joined admin_notifications room`);
        });

        socket.on('disconnect', () => {
            logger.info(`[Socket] Client disconnected: ${socket.id}`);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized!');
    }
    return io;
};

/**
 * Helper to emit admin notifications
 */
export const emitAdminNotification = (notification) => {
    if (io) {
        io.to('admin_notifications').emit('new_admin_notification', notification);
    } else {
        console.log('IO not initialized, cannot emit notification');
    }
};
