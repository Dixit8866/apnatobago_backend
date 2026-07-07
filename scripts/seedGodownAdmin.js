/**
 * Seed Script — Default Godown Admin
 * 
 * Creates:
 *   1. A "Master Godown" entry (type: main)
 *   2. A GodownStaff with role: superadmin
 *      email: godownadmin@gmail.com
 *      password: godownadmin@gmail.com
 * 
 * Usage: node scripts/seedGodownAdmin.js
 */

import dotenv from 'dotenv';
dotenv.config();

import sequelize from '../config/db.js';
import Godown from '../models/superadmin-models/Godown.js';
import GodownStaff from '../models/superadmin-models/GodownStaff.js';

async function seedGodownAdmin() {
    try {
        await sequelize.authenticate();
        console.log('[Seed] DB Connected');

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
            console.log(`[Seed] Created Master Godown: ${masterGodown.id}`);
        } else {
            console.log(`[Seed] Master Godown already exists: ${masterGodown.id}`);
        }

        // 2. Find or create GodownStaff (superadmin)
        const existing = await GodownStaff.findOne({ where: { email: 'godownadmin@gmail.com' } });
        if (existing) {
            console.log('[Seed] GodownStaff already exists with email: godownadmin@gmail.com');
            console.log('[Seed] Seeding complete. ✓');
            process.exit(0);
        }

        const staff = await GodownStaff.create({
            godownId: masterGodown.id,
            name: 'Godown Admin',
            email: 'godownadmin@gmail.com',
            password: 'godownadmin@gmail.com',
            role: 'superadmin',
            phone: null,
            status: 'Active',
        });

        console.log(`[Seed] Created GodownStaff: ${staff.id}`);
        console.log('[Seed] ============================================');
        console.log('[Seed]  Email    : godownadmin@gmail.com');
        console.log('[Seed]  Password : godownadmin@gmail.com');
        console.log('[Seed]  Role     : superadmin (sees all data)');
        console.log('[Seed] ============================================');
        console.log('[Seed] Seeding complete. ✓');
        process.exit(0);
    } catch (error) {
        console.error('[Seed Error]', error.message);
        process.exit(1);
    }
}

seedGodownAdmin();
