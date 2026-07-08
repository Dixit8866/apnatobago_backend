import http from 'http';
import app from './app.js';
import sequelize, { connectDB } from './config/db.js';
import { runManualMigrations } from './models/index.js';

// Setup Port
const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
import { initSocket } from './socket.js';
initSocket(server);

import { initReminderCron } from './utils/reminderCron.js';
initReminderCron();

// Import Models for seeding
import Admin from './models/superadmin-models/Admin.js';
import Godown from './models/superadmin-models/Godown.js';
import GodownStaff from './models/superadmin-models/GodownStaff.js';

// ─── Seed Admin Function ──────────────────────────────────────────────────────
const seedAdmin = async () => {
    try {
        const existing = await Admin.findOne({ where: { email: 'apnatobacco@gmail.com' } });
        if (!existing) {
            await Admin.create({
                name: 'Super Admin',
                email: 'apnatobacco@gmail.com',
                password: 'apnatobacco123', 
                role: 'superadmin',
                status: 'Active'
            });
            console.log('[Seed] SuperAdmin created successfully ✓');
        } else {
            const isMatch = await existing.matchPassword('apnatobacco123');
            if (!isMatch) {
                existing.password = 'apnatobacco123';
                await existing.save();
                console.log('[Seed] SuperAdmin password updated/corrected to default ✓');
            }
        }
    } catch (error) {
        console.error('[Seed Error] Failed to seed admin:', error.message);
    }
};

// ─── Seed Godown Admin Function ───────────────────────────────────────────────
const seedGodownAdmin = async () => {
    try {
        // 1. Find or create Master Godown
        const [masterGodown, godownCreated] = await Godown.findOrCreate({
            where: { name: 'Master Godown', type: 'main' },
            defaults: {
                name: 'Master Godown',
                type: 'main',
                address: 'Head Office',
                status: 'Active',
                pincodes: [],
            }
        });

        if (godownCreated) {
            console.log(`[Seed] Created Master Godown: ${masterGodown.id} ✓`);
        }

        // 2. Find or create GodownStaff (superadmin)
        const existing = await GodownStaff.findOne({ where: { email: 'godownadmin@gmail.com' } });
        if (!existing) {
            await GodownStaff.create({
                godownId: masterGodown.id,
                name: 'Godown Admin',
                email: 'godownadmin@gmail.com',
                password: 'godownadmin@gmail.com',
                role: 'superadmin',
                phone: null,
                status: 'Active',
            });
            console.log(`[Seed] GodownStaff (godownadmin@gmail.com) created successfully ✓`);
        } else {
            const isMatch = await existing.matchPassword('godownadmin@gmail.com');
            if (!isMatch) {
                existing.password = 'godownadmin@gmail.com';
                await existing.save();
                console.log('[Seed] GodownStaff (godownadmin@gmail.com) password updated/corrected to default ✓');
            }
        }
    } catch (error) {
        console.error('[Seed Error] Failed to seed godown admin:', error.message);
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
        
        // Seed SuperAdmin if database is empty
        await seedAdmin();
        // Seed Godown Admin if database is empty / not present
        await seedGodownAdmin();
        
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