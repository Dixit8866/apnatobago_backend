import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// Define Log Levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

// Colors for terminal logs
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'blue',
};

winston.addColors(colors);

// Format for Log Files
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.uncolorize(),
    winston.format.json()
);

// Format for Terminal / Console Output
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}`
    )
);

// Define Transports (Destinations)
const transports = [
    // Print to Console
    new winston.transports.Console({
        format: consoleFormat,
    }),

    // Log API / HTTP Requests to everyday file
    new DailyRotateFile({
        filename: 'logs/requests-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'http', // Capture api requests logged via Morgan
        format: fileFormat,
        maxFiles: '14d', // Keep for 14 days
        maxSize: '20m', // Max 20 mb per file
    }),

    // Log All Application Errors
    new DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        format: fileFormat,
        maxFiles: '30d',
    }),
];

// Create Winston Event Logger Instance
const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'http',
    levels,
    transports,
});

export default logger;
