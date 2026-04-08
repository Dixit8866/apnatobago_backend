import GodownStaff from '../../models/superadmin-models/GodownStaff.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';

const SAFE_ATTRIBUTES = { exclude: ['password'] };

// ─── CREATE STAFF (GODOWN PANEL) ──────────────────────────────────────────────
export const createStaff = async (req, res, next) => {
    try {
        const { name, email, password, role, phone, address, salary, profileImage, status } = req.body;
        const godownId = req.user.godownId; // Inherit from the logged in user

        if (!name || !email || !password) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Name, email, and password are required.");
        }

        const existing = await GodownStaff.findOne({ where: { email } });
        if (existing) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "A staff member with this email already exists.");
        }

        const staff = await GodownStaff.create({
            godownId, name, email, password,
            role: role || 'staff',
            phone, address, salary, profileImage,
            status: status || 'Active',
        });

        const safeStaff = await GodownStaff.findByPk(staff.id, { attributes: SAFE_ATTRIBUTES });
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Staff created successfully.", safeStaff);
    } catch (error) {
        next(error);
    }
};

// ─── GET ALL STAFF (ONLY FOR THIS GODOWN) ─────────────────────────────────────
export const getAllStaff = async (req, res, next) => {
    try {
        const { search = '', status } = req.query;
        const godownId = req.user.godownId;

        const baseWhere = { godownId };
        
        const searchWhere = search
            ? {
                [Op.and]: [
                    baseWhere,
                    {
                        [Op.or]: [
                            { name: { [Op.iLike]: `%${search}%` } },
                            { email: { [Op.iLike]: `%${search}%` } },
                            { phone: { [Op.iLike]: `%${search}%` } },
                        ]
                    }
                ]
            }
            : baseWhere;

        const whereWithStatus = { ...searchWhere };
        if (status) {
            whereWithStatus.status = status;
        }

        const [activeCount, inactiveCount, totalCount] = await Promise.all([
            GodownStaff.count({ where: { ...searchWhere, status: 'Active' } }),
            GodownStaff.count({ where: { ...searchWhere, status: 'Inactive' } }),
            GodownStaff.count({ where: searchWhere }),
        ]);

        const statusCounts = { All: totalCount, Active: activeCount, Inactive: inactiveCount };

        if (req.query.paginate === 'false') {
            const staff = await GodownStaff.findAll({
                where: whereWithStatus,
                attributes: SAFE_ATTRIBUTES,
                order: [['createdAt', 'DESC']]
            });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Staff fetched.", { staff, statusCounts });
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await GodownStaff.findAndCountAll({
            where: whereWithStatus,
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
        const staff = await GodownStaff.findOne({ 
            where: { id: req.params.id, godownId: req.user.godownId },
            attributes: SAFE_ATTRIBUTES 
        });
        if (!staff) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Staff not found or access denied.");
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Staff fetched.", staff);
    } catch (error) {
        next(error);
    }
};

// ─── UPDATE STAFF ─────────────────────────────────────────────────────────────
export const updateStaff = async (req, res, next) => {
    try {
        const { name, email, password, role, phone, address, salary, profileImage, status } = req.body;
        const staff = await GodownStaff.findOne({ where: { id: req.params.id, godownId: req.user.godownId } });
        if (!staff) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Staff not found or access denied.");

        if (email && email !== staff.email) {
            const existing = await GodownStaff.findOne({ where: { email } });
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
            status: status ?? staff.status,
        };
        if (password) updateData.password = password;

        await staff.update(updateData);
        const updated = await GodownStaff.findByPk(staff.id, { attributes: SAFE_ATTRIBUTES });
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Staff updated.", updated);
    } catch (error) {
        next(error);
    }
};

// ─── DELETE STAFF ─────────────────────────────────────────────────────────────
export const deleteStaff = async (req, res, next) => {
    try {
        const staff = await GodownStaff.findOne({ where: { id: req.params.id, godownId: req.user.godownId } });
        if (!staff) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Staff not found or access denied.");
        
        await staff.destroy();
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Staff deleted successfully.");
    } catch (error) {
        next(error);
    }
};
