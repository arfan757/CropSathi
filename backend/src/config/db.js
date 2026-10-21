import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createClient } from '@supabase/supabase-js';

// Explicitly load .env from the backend or workspace root folder
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function getMongoUri() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (uri && process.env.MONGODB_URI && process.env.MONGO_URI) {
    console.log('⚠️  Both MONGODB_URI and MONGO_URI set — using MONGODB_URI. Remove the other to silence this warning.');
  }
  return uri;
}

const connectDB = async () => {
  // Check if Supabase configuration is present
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      console.log('⏳ Connecting to Supabase (PostgreSQL)...');
      const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false },
      });

      // Quick ping test against users or postgis
      const { data, error } = await supabase.from('users').select('id').limit(1);
      if (error && !error.message.includes('relation "users" does not exist')) {
        console.warn(`⚠️ Supabase ping warning: ${error.message}`);
      } else {
        console.log(`✅ Supabase Connected Successfully: ${supabaseUrl}`);
      }
      return;
    } catch (err) {
      console.error(`❌ Supabase Connection Error: ${err.message}`);
    }
  }

  // Fallback to MongoDB if MONGODB_URI is provided
  const connUri = getMongoUri();
  if (connUri) {
    try {
      console.log('⏳ Connecting to MongoDB Atlas...');
      const conn = await mongoose.connect(connUri, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log(`✅ MongoDB Connected Successfully: ${conn.connection.host}`);
      console.log(`📁 Database Name: ${conn.connection.name}`);
      return;
    } catch (error) {
      console.error(`❌ MongoDB Connection Error: ${error.message}`);
      console.log('💡 Tip: If migrating to Supabase, provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    }
  }

  console.error('❌ No valid database connection available. Please configure SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY (recommended) or MONGODB_URI in your .env');
};

export default connectDB;