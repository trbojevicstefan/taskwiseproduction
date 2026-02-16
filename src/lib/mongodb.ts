import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is not set.");
}

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

if (process.env.NODE_ENV === "development") {
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else if (process.env.NODE_ENV === "test") {
  // Unit tests should be able to import modules that depend on getDb() without
  // requiring a live Mongo instance at module-load time.
  client = new MongoClient(uri);
  clientPromise = Promise.resolve(client);
} else {
  client = new MongoClient(uri);
  clientPromise = client.connect();
}

export default clientPromise;
