import clientPromise from "@/lib/mongodb";

export const getDb = async () => {
  const client = await clientPromise;
  const dbName = process.env.MONGODB_DB || "taskwise";
  return client.db(dbName);
};
