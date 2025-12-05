import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';

// Import configurations and utilities
import { config, validateEnvironment } from './config/env.js';
import logger from './utils/logger.js';
import { handleSocketConnection } from './socket/socketHandler.js';

// Import routes
import authRoutes from './routes/authRoutes.js';
import pollRoutes from './routes/pollRoutes.js';
import healthRoutes from './routes/healthRoutes.js';

// Validate environment variables at startup
validateEnvironment();

const app = express();
const server = createServer(app);

// Socket.IO setup with CORS
const io = new Server(server, {
  cors: {
    origin: config.socket.corsOrigin,
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Track active connections so we can forcefully destroy them on shutdown
const activeConnections = new Set();
server.on('connection', (socket) => {
  activeConnections.add(socket);
  socket.on('close', () => activeConnections.delete(socket));
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
  optionsSuccessStatus: 200
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info('HTTP Request', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/polls', pollRoutes);
app.use('/api', healthRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });

  res.status(err.status || 500).json({
    success: false,
    message: config.env === 'production' ? 'Internal server error' : err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Database connection with retry logic
const connectDB = async () => {
  const maxRetries = 5;
  let retries = 0;

  // Configure mongoose autoIndex: enable in development, disable in production by default
  try {
    const autoIndex = config.env !== 'production';
    mongoose.set('autoIndex', autoIndex);
    logger.info(`Mongoose autoIndex set to ${autoIndex}`);
  } catch (e) {
    logger.warn('Failed to set mongoose autoIndex', e?.message || e);
  }

  while (retries < maxRetries) {
    try {
      await mongoose.connect(config.mongodb.uri, {
        // Remove deprecated options
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      
      logger.info('MongoDB connected successfully');
      break;
    } catch (error) {
      retries++;
      logger.error(`MongoDB connection attempt ${retries} failed:`, error.message);
      
      if (retries === maxRetries) {
        logger.error('Max MongoDB connection retries reached. Exiting...');
        process.exit(1);
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// MongoDB event handlers
mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
});

// Socket.IO connection handling
handleSocketConnection(io);

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new connections
  try {
    io.close();
    logger.info('Socket.IO server closed');
  } catch (err) {
    logger.warn('Error closing Socket.IO server', err?.message || err);
  }

  // Destroy any remaining active connections (forces server.close callback)
  for (const sock of activeConnections) {
    try {
      sock.destroy();
    } catch (e) {
      logger.warn('Error destroying socket', e?.message || e);
    }
  }

  server.close(async (err) => {
    if (err) logger.error('Error closing HTTP server', err?.message || err);
    logger.info('HTTP server closed');

    try {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed');
      process.exit(0);
    } catch (e) {
      logger.error('Error closing MongoDB connection', e?.message || e);
      process.exit(1);
    }
  });

  // Force close after 30 seconds
  setTimeout(() => {
    logger.error('Forcing shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

// Start server
const startServer = async () => {
  try {
    await connectDB();
    
    server.listen(config.port, () => {
      logger.info(`Server running on port ${config.port} in ${config.env} mode`);
      logger.info('Health check available at /api/health');
    });
  } catch (error) {
    logger.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();