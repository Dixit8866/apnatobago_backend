import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: 'd:/Majesticai/tobaco/backend/.env' });

const { Client } = pg;

const createDatabase = async () => {
    const config = {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: 'postgres' // Connect to default database
    };

    const client = new Client(config);

    try {
        await client.connect();
        console.log('Connected to PostgreSQL (default database)');

        // Check if database exists
        const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'tobaco_app'`);
        
        if (res.rowCount === 0) {
            console.log('Database "tobaco_app" does not exist. Creating...');
            await client.query('CREATE DATABASE tobaco_app');
            console.log('Database "tobaco_app" created successfully!');
        } else {
            console.log('Database "tobaco_app" already exists.');
        }

    } catch (err) {
        console.error('Error creating database:', err.message);
    } finally {
        await client.end();
    }
};

createDatabase();
