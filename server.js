import http from 'http';
import app from './app.js';
import sequelize, { connectDB } from './config/db.js';
import './models/index.js'; // Import models to ensure all associations are registered before sync

// Setup Port
const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
import { initSocket } from './socket.js';
initSocket(server);

// Initialize Cron Jobs
import { initReminderCron } from './utils/reminderCron.js';
initReminderCron();

// ─── Start Server ─────────────────────────────────────────────────────────────
const startServer = async () => {
    try {
        // Connect to Database
        await connectDB();

        // Note: Automatic sync is disabled since schema is already established.
        // await sequelize.sync({ force: false, alter: { drop: false } });
        // console.log('[Database] Sequelize Models Synced');

        server.listen(PORT, '0.0.0.0', () => {
            console.log(`[Server] running in ${process.env.NODE_ENV} mode on port ${PORT}`);
            console.log(`[Network] Access at http://192.168.1.50:${PORT}`);
        });
    } catch (error) {
        console.error(`[Server Error] Failed to start server:`, error.message);
        process.exit(1);
    }
};

startServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
    console.log(`[Error] Unhandled Rejection: ${err.message}`);
    server.close(() => process.exit(1));
});
