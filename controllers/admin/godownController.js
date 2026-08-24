import Godown from '../../models/superadmin-models/Godown.js';
import { Op } from 'sequelize';
import { logActivity } from '../../helpers/activityLog.helper.js';

export const createGodown = async (req, res) => {
    try {
        const { name, type, address, pincodes, status } = req.body;
        const godown = await Godown.create({ name, type, address, pincodes, status });

        const godownName = typeof name === 'object' ? (name.en || name.gu || 'Godown') : String(name || 'Godown');

        logActivity(req, {
            module: 'Godown Management',
            action: 'CREATE',
            description: `Created Godown "${godownName}" (${type || 'sub'})`,
            metadata: { godownId: godown.id }
        });

        res.status(201).json({ success: true, message: "Godown created successfully", data: godown });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getGodowns = async (req, res) => {
    try {
        const { page = 1, limit = 50, search = '', type, all } = req.query;

        let whereClause = {};
        if (search) {
            whereClause.name = { [Op.iLike]: `%${search}%` };
        }
        if (type) {
            whereClause.type = type;
        }

        if (all === 'true') {
            const godowns = await Godown.findAll({ where: whereClause, order: [['createdAt', 'DESC']] });
            return res.status(200).json({ success: true, data: godowns });
        }

        const offset = (page - 1) * limit;
        const { count, rows } = await Godown.findAndCountAll({
            where: whereClause,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['createdAt', 'DESC']]
        });

        const allCount = await Godown.count();
        const mainCount = await Godown.count({ where: { type: 'main' } });
        const subCount = await Godown.count({ where: { type: 'sub' } });

        res.status(200).json({
            success: true,
            data: rows,
            pagination: {
                totalDetails: count,
                totalPages: Math.ceil(count / limit),
                currentPage: parseInt(page),
                limit: parseInt(limit)
            },
            counts: {
                all: allCount,
                main: mainCount,
                sub: subCount
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getGodownById = async (req, res) => {
    try {
        const godown = await Godown.findByPk(req.params.id);
        if (!godown) return res.status(404).json({ success: false, message: "Godown not found" });
        res.status(200).json({ success: true, data: godown });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateGodown = async (req, res) => {
    try {
        const { name, type, address, pincodes, status } = req.body;
        const godown = await Godown.findByPk(req.params.id);
        if (!godown) return res.status(404).json({ success: false, message: "Godown not found" });

        await godown.update({ name, type, address, pincodes, status });

        const godownName = typeof godown.name === 'object' ? (godown.name.en || godown.name.gu || 'Godown') : String(godown.name || 'Godown');

        logActivity(req, {
            module: 'Godown Management',
            action: 'UPDATE',
            description: `Updated Godown "${godownName}"`,
            metadata: { godownId: godown.id }
        });

        res.status(200).json({ success: true, message: "Godown updated successfully", data: godown });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteGodown = async (req, res) => {
    try {
        const godown = await Godown.findByPk(req.params.id);
        if (!godown) return res.status(404).json({ success: false, message: "Godown not found" });

        const godownName = typeof godown.name === 'object' ? (godown.name.en || godown.name.gu || 'Godown') : String(godown.name || 'Godown');

        try {
            await godown.destroy();
        } catch (dbErr) {
            if (dbErr.name === 'SequelizeForeignKeyConstraintError' || dbErr.code === '23503') {
                await godown.update({ status: 'Inactive' });

                logActivity(req, {
                    module: 'Godown Management',
                    action: 'DELETE',
                    description: `Deactivated Godown "${godownName}" (has past stock transfers/records)`,
                    metadata: { godownId: req.params.id }
                });

                return res.status(200).json({
                    success: true,
                    message: `Godown "${godownName}" contains historical stock transfer records, so its status was updated to Inactive.`
                });
            }
            throw dbErr;
        }

        logActivity(req, {
            module: 'Godown Management',
            action: 'DELETE',
            description: `Deleted Godown "${godownName}"`,
            metadata: { godownId: req.params.id }
        });

        res.status(200).json({ success: true, message: "Godown deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
