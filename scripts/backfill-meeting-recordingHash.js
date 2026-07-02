#!/usr/bin/env node
const { MongoClient } = require('mongodb');
require('dotenv').config();
const crypto = require('crypto');
const getRecordingHashKey = () => process.env.NEXTAUTH_SECRET || process.env.FATHOM_CLIENT_SECRET || '';
const hashFathomRecordingId = (userId, recordingId) => {
  const key = getRecordingHashKey() || userId;
  return crypto.createHmac('sha256', key).update(`${userId}:${recordingId}`).digest('hex');
};

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const meetings = db.collection('meetings');

  const cursor = meetings.find({ recordingId: { $exists: true }, $or: [{ recordingIdHash: { $exists: false } }, { recordingIdHash: null }] });
  let count = 0;
  let updated = 0;
  while (await cursor.hasNext()) {
    const m = await cursor.next();
    count++;
    const userId = String(m.userId || m.user || '');
    const recordingId = m.recordingId;
    if (!userId || !recordingId) continue;
    const hash = hashFathomRecordingId(userId, String(recordingId));
    console.log(`Will set recordingIdHash for meeting ${m._id} -> ${hash}`);
    await meetings.updateOne({ _id: m._id }, { $set: { recordingIdHash: hash } });
    updated++;
  }
  console.log(`Scanned ${count}, updated ${updated}`);
  await client.close();
})();
