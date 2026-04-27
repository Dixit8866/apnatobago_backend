import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const useSSL = process.env.DB_SSL === 'true';

/**
 * Configure Sequelize to connect to PostgreSQL
 * - Development: no SSL, alter:true (auto schema updates)
 * - Production:  SSL optional, force:false (safe, no data loss)
 */
const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
        host: process.env.DB_HOST,
        dialect: 'postgres',
        port: parseInt(process.env.DB_PORT) || 5432,
        logging: false, // Set to console.log to debug SQL

        // SSL configuration for remote/managed PostgreSQL (e.g. Hostinger managed DB)
        dialectOptions: useSSL
            ? {
                  ssl: {
                      require: true,
                      rejectUnauthorized: false // For self-signed certs on VPS
                  }
              }
            : {},

        pool: {
            max: isProduction ? 10 : 5,  // More connections in production
            min: 0,
            acquire: 30000,
            idle: 10000
        }
    }
);

/**
 * Connect to PostgreSQL Database
 */
export const connectDB = async () => {
    try {
        await sequelize.authenticate();
        console.log(`[Database] PostgreSQL Connected Successfully (${process.env.NODE_ENV} mode)`);
        console.log(`[Database] Host: ${process.env.DB_HOST}:${process.env.DB_PORT} | DB: ${process.env.DB_NAME}`);
    } catch (error) {
        console.error(`[Database Error] Unable to connect to PostgreSQL: ${error.message}`);
        process.exit(1);
    }
};

export default sequelize;
