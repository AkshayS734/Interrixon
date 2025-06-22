import express from 'express';
import mongoose from 'mongoose';
import Poll from '../models/Poll.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Basic health check
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// Detailed health check
router.get('/health/detailed', async (req, res) => {
  const healthcheck = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: new Date().toISOString(),
    checks: {}
  };

  try {
    // Database health check
    const dbState = mongoose.connection.readyState;
    healthcheck.checks.database = {
      status: dbState === 1 ? 'healthy' : 'unhealthy',
      state: dbState,
      message: dbState === 1 ? 'Connected' : 'Disconnected'
    };

    // Test database query
    if (dbState === 1) {
      const pollCount = await Poll.countDocuments();
      healthcheck.checks.database.pollCount = pollCount;
    }

    // Memory usage
    const memUsage = process.memoryUsage();
    healthcheck.checks.memory = {
      status: memUsage.heapUsed < memUsage.heapTotal * 0.9 ? 'healthy' : 'warning',
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)} MB`
    };

    // Environment variables check
    const requiredEnv = ['MONGODB_URI', 'JWT_SECRET'];
    const missingEnv = requiredEnv.filter(key => !process.env[key]);
    healthcheck.checks.environment = {
      status: missingEnv.length === 0 ? 'healthy' : 'unhealthy',
      missing: missingEnv
    };

    // Overall status
    const allHealthy = Object.values(healthcheck.checks)
      .every(check => check.status === 'healthy');
    
    healthcheck.status = allHealthy ? 'healthy' : 'unhealthy';

    res.status(allHealthy ? 200 : 503).json(healthcheck);

  } catch (error) {
    logger.error('Health check error', { error: error.message });
    
    healthcheck.status = 'unhealthy';
    healthcheck.message = error.message;
    
    res.status(503).json(healthcheck);
  }
});

// Readiness probe (for Kubernetes)
router.get('/ready', async (req, res) => {
  try {
    // Check if database is ready
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database not ready');
    }

    // Perform a simple query to ensure DB is responsive
    await mongoose.connection.db.admin().ping();

    res.status(200).json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ 
      status: 'not ready', 
      error: error.message 
    });
  }
});

// Liveness probe (for Kubernetes)
router.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

export default router;