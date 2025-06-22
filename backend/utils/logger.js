import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Define log colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'cyan',
  http: 'magenta',
  debug: 'white'
};

// Tell winston that you want to link the colors
winston.addColors(colors);

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => {
      const { timestamp, level, message, ...meta } = info;
      const metaString = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
      return `${timestamp} [${level}]: ${message} ${metaString}`;
    }
  )
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
import fs from 'fs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define transports
const transports = [
  // Console transport
  new winston.transports.Console({
    level: process.env.LOG_LEVEL || 'info',
    format: consoleFormat
  }),
  
  // File transport for all logs
  new winston.transports.File({
    filename: path.join(logsDir, 'app.log'),
    level: 'info',
    format: fileFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }),
  
  // Separate file for errors
  new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    format: fileFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5
  })
];

// Add daily rotate file transport for production
if (process.env.NODE_ENV === 'production') {
  try {
    const DailyRotateFile = (await import('winston-daily-rotate-file')).default;
    
    transports.push(
      new DailyRotateFile({
        filename: path.join(logsDir, 'app-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
        format: fileFormat,
        level: 'info'
      })
    );
  } catch (error) {
    // winston-daily-rotate-file not installed, continue without it
    console.warn('winston-daily-rotate-file not installed, using regular file transport');
  }
}

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: fileFormat,
  transports,
  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      format: fileFormat
    })
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      format: fileFormat
    })
  ]
});

// If we're not in production, don't log to files during testing
if (process.env.NODE_ENV === 'test') {
  logger.clear();
  logger.add(new winston.transports.Console({
    level: 'error',
    format: consoleFormat
  }));
}

// Create a stream object for Morgan HTTP logging
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

// Helper methods for structured logging
logger.logError = (message, error, metadata = {}) => {
  logger.error(message, {
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name
    },
    ...metadata
  });
};

logger.logRequest = (req, res, responseTime) => {
  logger.http('HTTP Request', {
    method: req.method,
    url: req.url,
    status: res.statusCode,
    responseTime: `${responseTime}ms`,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentLength: res.get('Content-Length')
  });
};

logger.logSocketEvent = (event, socketId, data = {}) => {
  logger.info('Socket Event', {
    event,
    socketId,
    ...data
  });
};

logger.logDatabaseOperation = (operation, collection, query = {}, result = {}) => {
  logger.debug('Database Operation', {
    operation,
    collection,
    query,
    result: {
      affected: result.modifiedCount || result.deletedCount || result.insertedCount,
      acknowledged: result.acknowledged
    }
  });
};

logger.logPerformance = (operation, duration, metadata = {}) => {
  logger.info('Performance', {
    operation,
    duration: `${duration}ms`,
    ...metadata
  });
};

// Add correlation ID support for tracing requests
logger.withCorrelationId = (correlationId) => {
  return logger.child({ correlationId });
};

// Add request context
logger.withContext = (context) => {
  return logger.child(context);
};

// Performance timer utility
logger.timer = (label) => {
  const start = Date.now();
  return {
    end: (metadata = {}) => {
      const duration = Date.now() - start;
      logger.logPerformance(label, duration, metadata);
      return duration;
    }
  };
};

// Middleware to add correlation ID to requests
const correlationMiddleware = (req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || 
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  res.setHeader('x-correlation-id', req.correlationId);
  req.logger = logger.withCorrelationId(req.correlationId);
  
  next();
};

// Middleware for HTTP request logging
const httpLoggingMiddleware = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    (req.logger || logger).logRequest(req, res, duration);
  });
  
  next();
};

// Export the logger as default
export default logger;

// Named exports for utilities
export {
  correlationMiddleware,
  httpLoggingMiddleware
};