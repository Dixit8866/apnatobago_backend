import GodownStaff from '../../models/superadmin-models/GodownStaff.js';
import Godown from '../../models/superadmin-models/Godown.js';
import { Op } from 'sequelize';
import { logActivity } from '../../helpers/activityLog.helper.js';

export const createGodownStaff = async (req, res) => {
    try {
        const { godownId, name, email, password, role, phone, address, salary, profileImage, status } = req.body;

        if (!godownId || !name || !email || !password) {
            return res.status(400).json({ success: false, message: "godownId, name, email, and password are required." });
        }

        const godown = await Godown.findByPk(godownId);
        if (!godown) return res.status(404).json({ success: false, message: "Godown not found" });

        const existing = await GodownStaff.findOne({ where: { email } });
        if (existing) return res.status(400).json({ success: false, message: "Email already in use." });

        const staff = await GodownStaff.create({
            godownId, name, email, password,
            role: role || 'staff',
            phone, address, salary, profileImage,
            status: status || 'Active'
        });

        logActivity(req, {
            module: 'Godown Staff',
            action: 'CREATE',
            description: `Created Godown Staff member "${name}" (${role || 'staff'})`,
            metadata: { staffId: staff.id, godownId }
        });

        const result = staff.toJSON();
        delete result.password;

        res.status(201).json({ success: true, message: "Godown Staff created successfully", data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getGodownStaffs = async (req, res) => {
    try {
        const { page = 1, limit = 50, search = '', role, status } = req.query;

        let whereClause = {};
        if (search) {
            whereClause[Op.or] = [
                { name: { [Op.iLike]: `%${search}%` } },
                { email: { [Op.iLike]: `%${search}%` } },
            ];
        }
        if (role) whereClause.role = role;
        if (status) whereClause.status = status;

        const offset = (page - 1) * limit;
        const { count, rows } = await GodownStaff.findAndCountAll({
            where: whereClause,
            attributes: { exclude: ['password'] },
            include: [{ model: Godown, as: 'godown', attributes: ['id', 'name', 'type'] }],
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['createdAt', 'DESC']]
        });

        const allCount = await GodownStaff.count();
        const activeCount = await GodownStaff.count({ where: { status: 'Active' } });
        const inactiveCount = await GodownStaff.count({ where: { status: 'Inactive' } });

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
                Active: activeCount,
                Inactive: inactiveCount
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getGodownStaffById = async (req, res) => {
    try {
        const staff = await GodownStaff.findByPk(req.params.id, {
            attributes: { exclude: ['password'] },
            include: [{ model: Godown, as: 'godown', attributes: ['id', 'name', 'type'] }]
        });
        if (!staff) return res.status(404).json({ success: false, message: "Godown Staff not found" });
        res.status(200).json({ success: true, data: staff });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateGodownStaff = async (req, res) => {
    try {
        const { godownId, name, email, password, role, phone, address, salary, profileImage, status } = req.body;
        const staff = await GodownStaff.findByPk(req.params.id);
        if (!staff) return res.status(404).json({ success: false, message: "Godown Staff not found" });

        if (email && email !== staff.email) {
            const existing = await GodownStaff.findOne({ where: { email } });
            if (existing) return res.status(400).json({ success: false, message: "Email already in use." });
        }

        const updateData = { name, email, role, phone, address, salary, profileImage, status };
        if (godownId) updateData.godownId = godownId;
        if (password) updateData.password = password;

        await staff.update(updateData);

        logActivity(req, {
            module: 'Godown Staff',
            action: 'UPDATE',
            description: `Updated Godown Staff member "${staff.name}"`,
            metadata: { staffId: staff.id }
        });

        const result = staff.toJSON();
        delete result.password;

        res.status(200).json({ success: true, message: "Godown Staff updated successfully", data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteGodownStaff = async (req, res) => {
    try {
        const staff = await GodownStaff.findByPk(req.params.id);
        if (!staff) return res.status(404).json({ success: false, message: "Godown Staff not found" });

        const staffName = staff.name;
        await staff.destroy();

        logActivity(req, {
            module: 'Godown Staff',
            action: 'DELETE',
            description: `Deleted Godown Staff member "${staffName}"`,
            metadata: { staffId: req.params.id }
        });

        res.status(200).json({ success: true, message: "Godown Staff deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
