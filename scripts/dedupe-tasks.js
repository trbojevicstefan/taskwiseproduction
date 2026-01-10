#!/usr/bin/env node
require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('Please set MONGODB_URI environment variable pointing to your DB');
  process.exit(1);
}

const argv = require('minimist')(process.argv.slice(2));
const FIX = argv.fix || argv.f;
const CREATE_INDEX = argv['create-index'] || argv.i;
const LIMIT = Number(argv.limit || 100);

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const coll = db.collection('tasks');

  console.log('Connected to', uri.replace(/:.+@/, ':***@'));

  const matchStage = { sourceTaskId: { $exists: true, $ne: null } };

  const cursor = coll.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { userId: '$userId', sourceSessionId: '$sourceSessionId', sourceTaskId: '$sourceTaskId' },
        count: { $sum: 1 },
        ids: { $push: '$_id' },
        createds: { $push: '$createdAt' }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $limit: LIMIT }
  ], { allowDiskUse: true });

  const groups = await cursor.toArray();
  const totalGroups = groups.length;
  const totalDuplicates = groups.reduce((s, g) => s + (g.count - 1), 0);

  console.log(`Found ${totalGroups} duplicate groups (showing up to ${LIMIT}), ${totalDuplicates} extra documents total.`);

  groups.slice(0, 20).forEach((g, idx) => {
    console.log(`\nGroup ${idx + 1}: userId=${String(g._id.userId)} sourceSessionId=${String(g._id.sourceSessionId)} sourceTaskId=${String(g._id.sourceTaskId)} count=${g.count}`);
    console.log(' ids:', g.ids.map(id => id.toString()).join(', '));
    if (g.createds && g.createds.some(Boolean)) {
      console.log(' createdAt samples:', g.createds.slice(0,5).map(d => (d ? d.toISOString() : 'null')).join(', '));
    }
  });

  if (totalGroups === 0) {
    console.log('\nNo duplicates found.');
    await client.close();
    return;
  }

  if (CREATE_INDEX) {
    console.log('\nCreating unique index (partial) on { userId:1, sourceSessionId:1, sourceTaskId:1 }...');
    try {
      await coll.createIndex(
        { userId: 1, sourceSessionId: 1, sourceTaskId: 1 },
        { unique: true, partialFilterExpression: { sourceTaskId: { $exists: true } } }
      );
      console.log('Index created.');
    } catch (err) {
      console.error('Failed to create index:', err.message);
    }
  }

  if (FIX) {
    console.log('\nFix mode enabled: will dedupe by keeping one doc per group and deleting the rest.');
    for (const g of groups) {
      const ids = g.ids;
      // Prefer keeping an ObjectId instance if present, else first id
      let keep = ids.find(id => ObjectId.isValid(String(id)) && id instanceof ObjectId) || ids[0];
      const remove = ids.filter(id => id.toString() !== keep.toString());
      if (remove.length === 0) continue;
      const res = await coll.deleteMany({ _id: { $in: remove } });
      console.log(`Removed ${res.deletedCount} docs for sourceTaskId=${g._id.sourceTaskId}`);
    }
    console.log('Deduplication complete.');
  } else {
    console.log('\nRun with `--fix` to remove duplicates, or `--create-index` to add the unique index (non-destructive).');
  }

  await client.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
