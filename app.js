import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import superadminRoutes from './routes/superadmin-routes/index.js';
import godownpanelRoutes from './routes/godownpanel-routes/index.js';
import userRoutes from './routes/user-routes/index.js';
import deliveryRoutes from './routes/delivery-routes/index.js';
import { sendSuccessResponse, sendErrorResponse } from './utils/response.util.js';
import HTTP_STATUS from './constants/httpStatusCodes.js';
import APP_MESSAGES from './constants/messages.js';
import globalErrorHandler from './middlewares/error.middleware.js';
import logger from './logger/apiLogger.js';

dotenv.config();

// Initialize express app
const app = express();

// Winston HTTP Logging
const morganFormat = ':method :url :status :res[content-length] - :response-time ms';
app.use(morgan(morganFormat, {
    stream: { write: (message) => logger.http(message.trim()) }
}));

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const envOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [];
const allowedOrigins = [
    ...envOrigins,
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://localhost:8081', 
    'http://localhost:8082',
];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) {
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        callback(new Error(`CORS: Origin ${origin} is not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'x-api-key']
}));
app.use(helmet());

// Routes Grouping
app.use('/api/admin', superadminRoutes);
app.use('/api/godown-panel', godownpanelRoutes);
app.use('/api/user', userRoutes);
app.use('/api/delivery', deliveryRoutes);

// Health Check Route
app.get('/api/health', (req, res) => {
    return sendSuccessResponse(res, HTTP_STATUS.OK, APP_MESSAGES.SERVER_HEALTHY, {
        environment: process.env.NODE_ENV,
        uptime: process.uptime(),
    });
});

// 404 Route Not Found handling
app.use((req, res, next) => {
    return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, APP_MESSAGES.ROUTE_NOT_FOUND);
});

// Global Error Handler Middleware
app.use(globalErrorHandler);

export default app;

