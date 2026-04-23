import Godown from '../../models/superadmin-models/Godown.js';
import { Op } from 'sequelize';

export const createGodown = async (req, res) => {
    try {
        const { name, type, address, pincodes, status } = req.body;
        const godown = await Godown.create({ name, type, address, pincodes, status });
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

        // Calculate counts
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
        res.status(200).json({ success: true, message: "Godown updated successfully", data: godown });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteGodown = async (req, res) => {
    try {
        const godown = await Godown.findByPk(req.params.id);
        if (!godown) return res.status(404).json({ success: false, message: "Godown not found" });

        await godown.destroy();
        res.status(200).json({ success: true, message: "Godown deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
