import { MongoClient } from "mongodb";

let clientPromise: Promise<MongoClient> | undefined;

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

const createClientPromise = (): Promise<MongoClient> => {
  if (clientPromise) return clientPromise;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return Promise.reject(new Error("MONGODB_URI is not set."));
  }

  const client = new MongoClient(uri);

  if (process.env.NODE_ENV === "development") {
    if (!global._mongoClientPromise) {
      global._mongoClientPromise = client.connect();
    }
    clientPromise = global._mongoClientPromise;
  } else if (process.env.NODE_ENV === "test") {
    // Unit tests can resolve the client without opening a live connection.
    clientPromise = Promise.resolve(client);
  } else {
    clientPromise = client.connect();
  }

  return clientPromise;
};

// Keep the existing Promise-shaped API, but defer reading MONGODB_URI and
// opening a connection until a caller actually awaits the client. Next.js
// evaluates route module graphs during `next build`; database configuration
// should fail at runtime when the database is used, not merely when imported.
const lazyClientPromise = {
  then<TResult1 = MongoClient, TResult2 = never>(
    onfulfilled?: ((value: MongoClient) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return createClientPromise().then(onfulfilled, onrejected);
  },
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ) {
    return createClientPromise().catch(onrejected);
  },
  finally(onfinally?: (() => void) | null) {
    return createClientPromise().finally(onfinally);
  },
  [Symbol.toStringTag]: "Promise",
} as Promise<MongoClient>;

export default lazyClientPromise;
