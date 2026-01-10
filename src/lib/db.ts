import clientPromise from "@/lib/mongodb";

const shouldDebug = Boolean(process.env.DEBUG_DUPES);

const wrapCollection = (collName: string, coll: any) => {
  if (!shouldDebug) return coll;

  const methodsToWrap = [
    "insertOne",
    "insertMany",
    "updateOne",
    "updateMany",
    "replaceOne",
    "bulkWrite",
    "deleteMany",
  ];

  const wrapped: any = { ...coll };
  methodsToWrap.forEach((m) => {
    if (typeof coll[m] !== "function") return;
    wrapped[m] = async (...args: any[]) => {
      try {
        const ts = new Date().toISOString();
        console.log(`[DEBUG_DUPES] ${ts} collection=${collName} method=${m}`);
        console.log("  args:", JSON.stringify(args, (_k, v) => (typeof v === 'function' ? undefined : v), 2));
        const res = await coll[m](...args);
        console.log(`[DEBUG_DUPES] ${ts} collection=${collName} method=${m} result: ok`);
        return res;
      } catch (err) {
        console.error(`[DEBUG_DUPES] error in ${collName}.${m}:`, err);
        throw err;
      }
    };
  });

  return wrapped;
};

export const getDb = async () => {
  const client = await clientPromise;
  const dbName = process.env.MONGODB_DB || "taskwise";
  const db = client.db(dbName) as any;

  if (!shouldDebug) return db;

  const originalCollection = db.collection.bind(db);
  db.collection = (name: string, ...rest: any[]) => {
    const coll = originalCollection(name, ...rest);
    return wrapCollection(name, coll);
  };

  return db;
};

export default getDb;
