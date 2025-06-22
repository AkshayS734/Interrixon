// Create a file: backend/test-mongo.js
import mongoose from 'mongoose';

const MONGODB_URI = 'mongodb+srv://akshaycommits:ddOgyMkvUzUNorY1@cluster0.u9wen6s.mongodb.net/interrixon';

async function testConnection() {
  try {
    console.log('Testing MongoDB connection...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connection successful!');
    
    // Test a simple operation
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('Available collections:', collections.map(c => c.name));
    
    await mongoose.disconnect();
    console.log('Connection closed');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.error('Full error:', error);
  }
}

testConnection();