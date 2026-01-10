#!/usr/bin/env node
const { MongoClient } = require('mongodb');
require('dotenv').config();
(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const boardItems = db.collection('boardItems');
  const total = await boardItems.countDocuments();
  const missing = await boardItems.countDocuments({ $or: [{ taskCanonicalId: { $exists: false } }, { taskCanonicalId: null }] });
  const present = total - missing;
  console.log(`boardItems total=${total}, missingTaskCanonicalId=${missing}, present=${present}`);
  if (total > 0) {
    const sample = await boardItems.find().limit(5).toArray();
    console.log('Sample docs (up to 5):');
    sample.forEach(d => console.log(JSON.stringify(d)));
  }
  await client.close();
})();
