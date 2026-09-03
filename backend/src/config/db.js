import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Explicitly load .env from the root folder
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Docs and deployment guides use MONGODB_URI; older code used MONGO_URI.
// Accept both so existing setups keep working, preferring MONGODB_URI.
function getMongoUri() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (uri && process.env.MONGODB_URI && process.env.MONGO_URI) {
    console.log('⚠️  Both MONGODB_URI and MONGO_URI set — using MONGODB_URI. Remove the other to silence this warning.');
  }
  return uri;
}

const connectDB = async () => {
  try {
    const connUri = getMongoUri();

    if (!connUri) {
      console.log('🔍 Detected Environment Keys:', Object.keys(process.env).filter(k => !k.startsWith('npm_')));
      throw new Error('MONGODB_URI is missing in .env file');
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