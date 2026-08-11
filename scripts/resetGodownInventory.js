import sequelize from '../config/db.js';
import InventoryStock from '../models/superadmin-models/InventoryStock.js';
import Godown from '../models/superadmin-models/Godown.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resetGodownInventory() {
    const godownIdInput = process.argv[2];

    if (!godownIdInput) {
        console.log('\n======================================================');
        console.log('❌ Error: Godown ID or Name is required!');
        console.log('Usage: node scripts/resetGodownInventory.js <GODOWN_ID_OR_NAME>');
        console.log('======================================================\n');
        
        try {
            const godowns = await Godown.findAll({
                attributes: ['id', 'name', 'status'],
                order: [['createdAt', 'ASC']]
            });

            console.log('--- Available Registered Godowns ---');
            console.table(godowns.map(g => ({
                ID: g.id,
                Name: typeof g.name === 'object' ? (g.name?.en || Object.values(g.name)[0]) : g.name,
                Status: g.status
            })));
        } catch (err) {
            console.error('Failed to list godowns:', err.message);
        }
        process.exit(0);
    }

    try {
        let godown = null;

        if (UUID_REGEX.test(godownIdInput)) {
            godown = await Godown.findByPk(godownIdInput);
        }

        // If not found by exact UUID, try searching by name
        if (!godown) {
            godown = await Godown.findOne({
                where: sequelize.where(
                    sequelize.cast(sequelize.col('name'), 'text'),
                    { [sequelize.Sequelize.Op.iLike]: `%${godownIdInput}%` }
                )
            });
        }

        if (!godown) {
            console.error(`\n❌ Godown "${godownIdInput}" not found in database! Please check the ID or Name.\n`);

            const godowns = await Godown.findAll({ attributes: ['id', 'name', 'status'] });
            console.log('--- Registered Godowns ---');
            console.table(godowns.map(g => ({
                ID: g.id,
                Name: typeof g.name === 'object' ? (g.name?.en || Object.values(g.name)[0]) : g.name,
                Status: g.status
            })));
            process.exit(1);
        }

        const targetGodownId = godown.id;
        const godownName = typeof godown.name === 'object' ? (godown.name?.en || Object.values(godown.name)[0]) : godown.name;

        console.log(`\n⏳ Resetting all product stock quantities to 0 for Godown: "${godownName}" (ID: ${targetGodownId})...`);

        const [affectedRows] = await InventoryStock.update(
            { totalBaseUnits: 0 },
            { where: { godownId: targetGodownId } }
        );

        console.log(`\n✅ SUCCESS! All product stock for Godown "${godownName}" is now set to 0.`);
        console.log(`📊 Total inventory stock entries updated: ${affectedRows}\n`);
    } catch (error) {
        console.error('\n❌ Failed to reset inventory stock:', error);
    } finally {
        process.exit(0);
    }
}

resetGodownInventory();
