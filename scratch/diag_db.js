
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

async function diagnostic() {
  const logFile = 'connection_log.txt';
  fs.writeFileSync(logFile, `Starting diagnostic at ${new Date().toISOString()}\n`);
  fs.appendFileSync(logFile, `URI: ${process.env.MONGODB_URI}\n`);

  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    fs.appendFileSync(logFile, '✅ Successfully connected to MongoDB!\n');
    process.exit(0);
  } catch (err) {
    fs.appendFileSync(logFile, `❌ Connection Error: ${err.message}\n`);
    fs.appendFileSync(logFile, `Stack: ${err.stack}\n`);
    process.exit(1);
  }
}

diagnostic();
