import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Explicitly load .env from the root folder
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const connectDB = async () => {
  try {
    const connUri = process.env.MONGO_URI;

    if (!connUri) {
      console.log('🔍 Detected Environment Keys:', Object.keys(process.env).filter(k => !k.startsWith('npm_')));
      throw new Error('MONGO_URI is missing in .env file');
    }

    console.log('⏳ Connecting to MongoDB Atlas...');

    const conn = await mongoose.connect(connUri, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log(`✅ MongoDB Connected Successfully: ${conn.connection.host}`);
    console.log(`📁 Database Name: ${conn.connection.name}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;