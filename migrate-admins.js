import sequelize from './config/db.js';

async function migrate() {
    try {
        await sequelize.query(`
            ALTER TABLE admins
                ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
                ADD COLUMN IF NOT EXISTS address TEXT,
                ADD COLUMN IF NOT EXISTS salary DECIMAL(10,2),
                ADD COLUMN IF NOT EXISTS "profileImage" VARCHAR(500),
                ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}',
                ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active'
        `);
        console.log('✅ Migration complete: new columns added to admins table');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration error:', e.message);
        process.exit(1);
    }
}
migrate();
