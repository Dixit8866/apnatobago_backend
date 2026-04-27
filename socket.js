import { Server } from 'socket.io';
import logger from './logger/apiLogger.js';

let io;

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: ["http://localhost:8081", "http://localhost:5173", "http://localhost:3000"],
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    io.on('connection', (socket) => {
        logger.info(`[Socket] Client connected: ${socket.id}`);

        socket.on('join_admin_room', () => {
            socket.join('admin_notifications');
            logger.info(`[Socket] Client ${socket.id} joined admin_notifications room`);
            console.log(`[Socket] Client ${socket.id} joined admin_notifications room`);
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
        console.log('Emitting admin notification:', notification.title);
        io.to('admin_notifications').emit('new_admin_notification', notification);
    } else {
        console.log('IO not initialized, cannot emit notification');
    }
};
