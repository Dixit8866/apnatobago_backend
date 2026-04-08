import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Generate a JSON Web Token
 * @param {string|number} id - The user ID to encode in the token payload
 * @returns {string} - The signed JWT
 */
export const generateToken = (payload) => {
    // If payload is a primitive (legacy support), wrap it in an object
    const data = typeof payload === 'object' ? payload : { id: payload };
    return jwt.sign(data, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '30d',
    });
};

/**
 * Verify a JSON Web Token
 * @param {string} token - The JWT token to verify
 * @returns {Object|null} - Decoded payload or null if invalid
 */
export const verifyToken = (token) => {
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return null;
    }
};
