#!/usr/bin/env node
require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const argv = require('minimist')(process.argv.slice(2));
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Set MONGODB_URI in .env');
  process.exit(1);
}
const ids = argv._.length ? argv._ : [
  'a2e57be0-5285-4a16-82db-579e0bbab708',
  '2140d0fb-5b2c-4768-b166-1b5d277cea00:a2e57be0-5285-4a16-82db-579e0bbab708'
];

(async function(){
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'taskwise');
  for (const rawId of ids) {
    console.log('\n=== Inspecting', rawId, '===');
    const normalized = rawId.includes(':') ? rawId.split(':').slice(1).join(':') : rawId;

    // boardItems matching
    const boardItems = await db.collection('boardItems').find({
      $or: [
        { taskId: rawId },
        { taskId: normalized },
        { taskId: { $in: [rawId, normalized] } },
        { taskCanonicalId: rawId },
        { taskCanonicalId: normalized }
      ]
    }).toArray();
    console.log('boardItems found:', boardItems.length);
    boardItems.slice(0,10).forEach(b => console.log(' -', b._id, 'taskId=', b.taskId, 'taskCanonicalId=', b.taskCanonicalId));

    // tasks matching
    const taskIds = [];
    if (ObjectId.isValid(rawId)) taskIds.push(new ObjectId(rawId));
    if (ObjectId.isValid(normalized)) taskIds.push(new ObjectId(normalized));

    const tasks = await db.collection('tasks').find({
      $or: [
        { _id: { $in: taskIds } },
        { id: rawId },
        { id: normalized },
        { sourceTaskId: rawId },
        { sourceTaskId: normalized }
      ].filter(Boolean)
    }).toArray();
    console.log('tasks found:', tasks.length);
    tasks.slice(0,10).forEach(t => console.log(' -', t._id?.toString?.(), 'sourceTaskId=', t.sourceTaskId, 'id=', t.id));

    // meetings referencing the normalized session id if present
    const possibleSession = rawId.includes(':') ? rawId.split(':')[0] : null;
    if (possibleSession) {
      const sessionOrId = [];
      sessionOrId.push({ _id: possibleSession });
      sessionOrId.push({ id: possibleSession });
      if (ObjectId.isValid(possibleSession)) {
        sessionOrId.push({ _id: new ObjectId(possibleSession) });
      }
      const meetings = await db.collection('meetings').find({ $or: sessionOrId }).toArray();
      console.log('meetings matching session prefix:', meetings.length);
      meetings.slice(0,3).forEach(m=> console.log(' -', m._id?.toString?.(), 'title=', m.title));

      const chatSessions = await db.collection('chatSessions').find({ $or: sessionOrId }).toArray();
      console.log('chatSessions matching session prefix:', chatSessions.length);
      chatSessions.slice(0,3).forEach(c=> console.log(' -', c._id?.toString?.(), 'title=', c.title));
    }

    // chatSessions that include suggestedTasks with this sourceTaskId
    const chatWithSuggested = await db.collection('chatSessions').find({ 'suggestedTasks.id': rawId }).toArray();
    console.log('chatSessions with suggestedTasks.id === rawId:', chatWithSuggested.length);
    const chatWithSuggested2 = await db.collection('chatSessions').find({ 'suggestedTasks.id': normalized }).toArray();
    console.log('chatSessions with suggestedTasks.id === normalized:', chatWithSuggested2.length);

    // meetings with extractedTasks.id
    const meetingsWithTask = await db.collection('meetings').find({ 'extractedTasks.id': rawId }).toArray();
    console.log('meetings with extractedTasks.id === rawId:', meetingsWithTask.length);
    const meetingsWithTask2 = await db.collection('meetings').find({ 'extractedTasks.id': normalized }).toArray();
    console.log('meetings with extractedTasks.id === normalized:', meetingsWithTask2.length);
  }
  await client.close();
})();
