import Joi from 'joi';
import { sendErrorResponse } from '../utils/response.util.js';
import HTTP_STATUS from '../constants/httpStatusCodes.js';
import APP_MESSAGES from '../constants/messages.js';

/**
 * Validates the registration request body using Joi
 */
export const validateRegister = (req, res, next) => {
    const schema = Joi.object({
        name: Joi.string().min(3).max(50).required().messages({
            'string.empty': 'Name cannot be empty',
            'string.min': 'Name must be at least 3 characters long',
        }),
        email: Joi.string().email().required().messages({
            'string.empty': 'Email cannot be empty',
            'string.email': 'Invalid email format',
        }),
        password: Joi.string().min(6).required().messages({
            'string.empty': 'Password cannot be empty',
            'string.min': 'Password must be at least 6 characters long',
        }),
    });

    const { error } = schema.validate(req.body, { abortEarly: false });

    if (error) {
        const errorMessages = error.details.map((detail) => detail.message);
        return sendErrorResponse(
            res,
            HTTP_STATUS.UNPROCESSABLE_ENTITY,
            APP_MESSAGES.VALIDATION_ERROR,
            errorMessages
        );
    }

    next();
};
