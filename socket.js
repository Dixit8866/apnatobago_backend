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
            origin: (origin, callback) => {
                // Allow mobile apps (which may send no origin, null, or custom file/capacitor/flutter scheme)
                if (!origin || origin === 'null') return callback(null, true);
                if (allowedOrigins.includes(origin)) return callback(null, true);
                // In development allow any origin
                if (process.env.NODE_ENV !== 'production') return callback(null, true);
                return callback(null, true); // Permissive for mobile clients
            },
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    io.on('connection', (socket) => {
        logger.info(`[Socket] Client connected: ${socket.id}`);

        // 1. Admin & Superadmin Join
        socket.on('join_admin_room', () => {
            socket.join('admin_notifications');
            socket.join('admin_orders');
            logger.info(`[Socket] Client ${socket.id} joined admin_notifications and admin_orders rooms`);
        });

        // 2. Godown Panel Join
        socket.on('join_godown_room', (godownId) => {
            if (godownId) {
                const roomName = `godown_${godownId}`;
                socket.join(roomName);
                logger.info(`[Socket] Client ${socket.id} joined room: ${roomName}`);
            }
        });

        // 3. Delivery Rider Join Area Route (e.g. "Varachha Route" as selected in delivery app)
        socket.on('join_area_room', (routeCategoryId) => {
            if (routeCategoryId) {
                const roomName = `area_${routeCategoryId}`;
                socket.join(roomName);
                logger.info(`[Socket] Delivery Rider ${socket.id} joined route area: ${roomName}`);
            }
        });

        socket.on('leave_area_room', (routeCategoryId) => {
            if (routeCategoryId) {
                const roomName = `area_${routeCategoryId}`;
                socket.leave(roomName);
                logger.info(`[Socket] Delivery Rider ${socket.id} left route area: ${roomName}`);
            }
        });

        // 4. Delivery Rider Personal Room (for assignments & private notifications)
        socket.on('join_rider_room', (deliveryBoyId) => {
            if (deliveryBoyId) {
                const roomName = `rider_${deliveryBoyId}`;
                socket.join(roomName);
                logger.info(`[Socket] Delivery Rider ${deliveryBoyId} registered personal socket room: ${roomName}`);
            }
        });

        socket.on('leave_rider_room', (deliveryBoyId) => {
            if (deliveryBoyId) {
                const roomName = `rider_${deliveryBoyId}`;
                socket.leave(roomName);
                logger.info(`[Socket] Delivery Rider ${deliveryBoyId} left personal socket room: ${roomName}`);
            }
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
