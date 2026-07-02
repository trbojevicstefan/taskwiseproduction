#!/usr/bin/env node
const { MongoClient } = require("mongodb");
require('dotenv').config();
const argv = require('minimist')(process.argv.slice(2));
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set in .env');
  process.exit(1);
}
const client = new MongoClient(uri);
(async () => {
  await client.connect();
  const db = client.db();
  const dryRun = !argv.fix;
  console.log(`Connected. dryRun=${dryRun}`);

  const boardItems = db.collection('boardItems');
  const tasks = db.collection('tasks');

  const cursor = boardItems.find({ $or: [{ taskCanonicalId: { $exists: false } }, { taskCanonicalId: null }] });
  let count = 0;
  let updates = 0;
  while (await cursor.hasNext()) {
    const item = await cursor.next();
    count++;
    const userId = item.userId || item.user || null;
    if (!userId) continue;
    const taskIdRaw = item.taskId || item.task || null;
    if (!taskIdRaw) continue;
    const parts = String(taskIdRaw).split(":");
    const sourceTaskId = parts.length > 1 ? parts[parts.length - 1] : String(taskIdRaw);
    const match = await tasks.findOne({ userId, sourceTaskId });
    if (match && match._id) {
      console.log(`Will set taskCanonicalId for boardItem ${item._id} -> ${String(match._id)}`);
      if (!dryRun) {
        await boardItems.updateOne({ _id: item._id }, { $set: { taskCanonicalId: String(match._id) } });
        updates++;
      }
    }
  }
  console.log(`Scanned ${count} boardItems. Updated ${updates} entries.`);
  await client.close();
})();
