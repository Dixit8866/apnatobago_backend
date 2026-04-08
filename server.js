import http from 'http';
import app from './app.js';
import sequelize, { connectDB } from './config/db.js';
import './models/index.js'; // Import models to ensure all associations are registered before sync

// Setup Port
const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Start the server
const startServer = async () => {
    try {
        // Connect to Database
        await connectDB();

        // Sync Sequelize Models with Database
        // Note: force: false won't drop existing tables. Set alter: true for schema updates during dev.
        await sequelize.sync({ force: false, alter: true });
        console.log('[Database] Sequelize Models Synced');

        server.listen(PORT, () => {
            console.log(`[Server] running in ${process.env.NODE_ENV} mode on port ${PORT}`);
        });
    } catch (error) {
        console.error(`[Server Error] Failed to start server:`, error.message);
        process.exit(1); // Exit process with failure
    }
};

startServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
    console.log(`[Error] Unhandled Rejection: ${err.message}`);
    server.close(() => process.exit(1));
});
