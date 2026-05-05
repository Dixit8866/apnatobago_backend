import http from 'http';
import app from './app.js';
import sequelize, { connectDB } from './config/db.js';
import { runManualMigrations } from './models/index.js'; // Import models and migration

// Setup Port
const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
import { initSocket } from './socket.js';
initSocket(server);

import { initReminderCron } from './utils/reminderCron.js';
initReminderCron();

// Import Admin model for seeding
import Admin from './models/superadmin-models/Admin.js';

// ─── Seed Admin Function ──────────────────────────────────────────────────────
const seedAdmin = async () => {
    try {
        const adminCount = await Admin.count();
        if (adminCount === 0) {
            await Admin.create({
                name: 'Super Admin',
                email: 'apnatobacco@gmail.com',
                password: 'apnatobacco123', // Will be hashed by model hook
                role: 'superadmin',
                status: 'Active'
            });
            console.log('[Seed] SuperAdmin created successfully ✓');
        }
    } catch (error) {
        console.error('[Seed Error] Failed to seed admin:', error.message);
    }
};

// ─── Start Server ─────────────────────────────────────────────────────────────
const startServer = async () => {
    try {
        // Connect to Database
        await connectDB();

        // Run manual migrations for missing columns/constraints
        await runManualMigrations();

        // Sync Sequelize Models with Database
        // Note: We are enabling this temporarily to create tables in your new database.
        await sequelize.sync({ force: false, alter: { drop: false } });
        console.log('[Database] Sequelize Models Synced');
        
        // Seed SuperAdmin if database is empty
        await seedAdmin();

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
