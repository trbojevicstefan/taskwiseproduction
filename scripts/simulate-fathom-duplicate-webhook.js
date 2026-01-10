#!/usr/bin/env node
const { MongoClient } = require('mongodb');
require('dotenv').config();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

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

  // pick an existing user or create a test user
  let user = await db.collection('users').findOne({});
  if (!user) {
    const testUser = { _id: uuidv4(), email: 'test+webhook@example.com', workspace: { id: uuidv4() } };
    await db.collection('users').insertOne(testUser);
    user = testUser;
    console.log('Created test user', user._id);
  } else {
    console.log('Using existing user', user._id);
  }

  const recordingId = `rec_${uuidv4()}`;
  const recordingHash = hashFathomRecordingId(String(user._id), String(recordingId));
  const meetingId = uuidv4();

  const meeting = {
    _id: meetingId,
    userId: String(user._id),
    workspaceId: user.workspace?.id || null,
    title: 'Simulated Fathom Meeting',
    recordingId,
    recordingIdHash: recordingHash,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    state: 'tasks_ready'
  };

  const meetings = db.collection('meetings');
  const filter = { userId: String(user._id), recordingIdHash: recordingHash };
  const setFields = { ...meeting };
  delete setFields._id;
  delete setFields.createdAt;

  console.log('Simulating two concurrent webhook upserts for recordingId:', recordingId);
  await Promise.all([
    meetings.updateOne(filter, { $set: setFields, $setOnInsert: { createdAt: meeting.createdAt, _id: meeting._id } }, { upsert: true }),
    meetings.updateOne(filter, { $set: setFields, $setOnInsert: { createdAt: meeting.createdAt, _id: meeting._id } }, { upsert: true }),
  ]);

  const found = await meetings.find({ userId: String(user._id), recordingIdHash: recordingHash }).toArray();
  console.log('Meetings matching recordingHash count=', found.length);
  found.forEach(m => console.log(JSON.stringify(m)));

  await client.close();
})();
