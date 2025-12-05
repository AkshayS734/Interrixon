import mongoose from 'mongoose';
import { config, validateEnvironment } from '../config/env.js';
import logger from '../utils/logger.js';
import Poll from '../models/Poll.js';

// Validate env first
validateEnvironment();

const run = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(config.mongodb.uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    logger.info('Connected to MongoDB for index sync');

    // Sync indexes for Poll model (creates any missing indexes defined in schema)
    const res = await Poll.syncIndexes();
    logger.info('Poll model indexes synced', { result: res });

    await mongoose.connection.close();
    logger.info('MongoDB connection closed after sync');
    process.exit(0);
  } catch (err) {
    logger.error('Failed to sync indexes', { error: err?.message || err });
    try { await mongoose.connection.close(); } catch (e) { /* ignore */ }
    process.exit(1);
  }
};

run();
