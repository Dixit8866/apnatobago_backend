import Admin from '../../models/superadmin-models/Admin.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';
import bcrypt from 'bcryptjs';

const SAFE_ATTRIBUTES = { exclude: ['password'] };

// ─── CREATE STAFF ─────────────────────────────────────────────────────────────
export const createStaff = async (req, res, next) => {
    try {
        const { name, email, password, role, phone, address, salary, profileImage, permissions, status } = req.body;

        if (!name || !email || !password) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Name, email, and password are required.");
        }

        const existing = await Admin.findOne({ where: { email } });
        if (existing) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "A staff member with this email already exists.");
        }

        const staff = await Admin.create({
            name, email, password,
            role: role || 'staff',
            phone: phone || null,
            address: address || null,
            salary: salary || null,
            profileImage: profileImage || null,
            permissions: permissions || {},
            status: status || 'Active',
        });

        const safeStaff = await Admin.findByPk(staff.id, { attributes: SAFE_ATTRIBUTES });
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Staff created successfully.", safeStaff);
    } catch (error) {
        next(error);
    }
};

// ─── GET ALL STAFF ────────────────────────────────────────────────────────────
export const getAllStaff = async (req, res, next) => {
    try {
        const { search = '', status } = req.query;

        const searchWhere = search
            ? {
                [Op.or]: [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { email: { [Op.iLike]: `%${search}%` } },
                    { phone: { [Op.iLike]: `%${search}%` } },
                ]
            }
            : {};

        const whereWithSearch = { ...searchWhere };
        if (status) {
            whereWithSearch.status = status;
        } else {
            whereWithSearch.status = { [Op.ne]: 'Deleted' };
        }

        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            Admin.count({ where: { ...searchWhere, status: 'Active' } }),
            Admin.count({ where: { ...searchWhere, status: 'Inactive' } }),
            Admin.count({ where: { ...searchWhere, status: 'Deleted' } }),
            Admin.count({ where: { ...searchWhere } }),
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const staff = await Admin.findAll({
                where: whereWithSearch,
                attributes: SAFE_ATTRIBUTES,
                order: [['createdAt', 'DESC']]
            });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Staff fetched.", { staff, statusCounts });
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await Admin.findAndCountAll({
            where: whereWithSearch,
            attributes: SAFE_ATTRIBUTES,
            limit, offset,
            order: [['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Staff fetched.", { ...responseData, statusCounts });
    } catch (error) {
        next(error);
    }
};

// ─── GET STAFF BY ID ──────────────────────────────────────────────────────────
export const getStaffById = async (req, res, next) => {
    try {
        const staff = await Admin.findByPk(req.params.id, { attributes: SAFE_ATTRIBUTES });
        if (!staff) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Staff not found.");
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Staff fetched.", staff);
    } catch (error) {
        next(error);
    }
};

// ─── UPDATE STAFF ─────────────────────────────────────────────────────────────
export const updateStaff = async (req, res, next) => {
    try {
        const { name, email, password, role, phone, address, salary, profileImage, permissions, status } = req.body;
        const staff = await Admin.findByPk(req.params.id);
        if (!staff) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Staff not found.");

        // Check email uniqueness if changed
        if (email && email !== staff.email) {
            const existing = await Admin.findOne({ where: { email } });
            if (existing) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Email already in use.");
        }

        const updateData = {
            name: name ?? staff.name,
            email: email ?? staff.email,
            role: role ?? staff.role,
            phone: phone !== undefined ? phone : staff.phone,
            address: address !== undefined ? address : staff.address,
            salary: salary !== undefined ? salary : staff.salary,
            profileImage: profileImage !== undefined ? profileImage : staff.profileImage,
            permissions: permissions !== undefined ? permissions : staff.permissions,
            status: status ?? staff.status,
        };
        if (password) updateData.password = password;

        await staff.update(updateData);
        const updated = await Admin.findByPk(staff.id, { attributes: SAFE_ATTRIBUTES });
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Staff updated.", updated);
    } catch (error) {
        next(error);
    }
};

// ─── SOFT DELETE STAFF ────────────────────────────────────────────────────────
export const deleteStaff = async (req, res, next) => {
    try {
        const staff = await Admin.findByPk(req.params.id);
        if (!staff) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Staff not found.");
        if (staff.role === 'superadmin') {
            return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, "Cannot delete a superadmin account.");
        }
        staff.status = 'Deleted';
        await staff.save();
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Staff deleted.");
    } catch (error) {
        next(error);
    }
};
