const { MongoClient, ObjectId } = require('mongodb');

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set in env');
    process.exit(2);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  // Find a meeting with extractedTasks
  const meeting = await db.collection('meetings').findOne({ extractedTasks: { $exists: true, $ne: [] } });
  if (!meeting) {
    console.log('No meeting with extractedTasks found.');
    await client.close();
    return;
  }

  console.log('Found meeting:', meeting._id.toString());
  const before = meeting.lastActivityAt || meeting.createdAt || null;
  console.log('meeting.lastActivityAt (before):', before);

  const taskItem = (meeting.extractedTasks || [])[0];
  if (!taskItem) {
    console.log('No extractedTasks items present.');
    await client.close();
    return;
  }
  const sourceId = taskItem.id || taskItem.sourceTaskId || taskItem._id || null;
  if (!sourceId) {
    console.log('Could not determine source id for extracted task item.');
    await client.close();
    return;
  }

  // Try to find linked task in tasks collection
  const candidates = [];
  // try _id as ObjectId
  if (ObjectId.isValid(String(sourceId))) {
    candidates.push({ _id: new ObjectId(String(sourceId)) });
  }
  candidates.push({ id: String(sourceId) });
  candidates.push({ sourceTaskId: String(sourceId) });

  const query = { userId: meeting.userId, sourceSessionType: 'meeting', $or: candidates };
  const task = await db.collection('tasks').findOne(query);
  if (!task) {
    console.log('No corresponding task found for extracted task id:', sourceId);
    await client.close();
    return;
  }

  console.log('Found task:', task._id.toString());

  // Update the task: set status and add a comment-like field (non-destructive)
  const update = { status: 'done', lastUpdated: new Date() };
  // If comments array exists, push a marker comment; otherwise set comments
  if (Array.isArray(task.comments)) {
    await db.collection('tasks').updateOne({ _id: task._id }, { $push: { comments: { text: 'VERIFY: status changed', createdAt: new Date() } }, $set: update });
  } else {
    await db.collection('tasks').updateOne({ _id: task._id }, { $set: { ...update, comments: [{ text: 'VERIFY: status changed', createdAt: new Date() }] } });
  }

  // Give any potential listeners a moment
  await new Promise((r) => setTimeout(r, 1000));

  const meetingAfter = await db.collection('meetings').findOne({ _id: meeting._id });
  const after = meetingAfter.lastActivityAt || meetingAfter.createdAt || null;
  console.log('meeting.lastActivityAt (after):', after);

  if (String(before) === String(after)) {
    console.log('SUCCESS: meeting.lastActivityAt did NOT change.');
  } else {
    console.log('NOTICE: meeting.lastActivityAt changed.');
  }

  await client.close();
}

run().catch((err) => { console.error(err); process.exit(1); });
