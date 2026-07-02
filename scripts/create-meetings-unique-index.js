#!/usr/bin/env node
const { MongoClient } = require('mongodb');
require('dotenv').config();
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set in .env');
  process.exit(1);
}
(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const dbName = process.env.MONGODB_DB || "taskwise";
  const db = client.db(dbName);
  const meetings = db.collection('meetings');
  try {
    console.log(
      `Creating unique index on { userId:1, recordingIdHash:1 } (partial on recordingIdHash) in DB "${dbName}"`
    );
    await meetings.createIndex(
      { userId: 1, recordingIdHash: 1 },
      { unique: true, partialFilterExpression: { recordingIdHash: { $exists: true } }, name: 'unique_user_recordingHash' }
    );
    console.log('Index created or already exists.');
  } catch (error) {
    console.error('Failed to create index:', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();
