import { ObjectId } from "mongodb";

export const buildIdQuery = (id: string) => {
  if (!id) return id;
  if (ObjectId.isValid(id)) {
    try {
      return { $in: [id, new ObjectId(id)] };
    } catch {
      return id;
    }
  }
  return id;
};

export const matchesId = (value: any, id: string) => {
  if (value === id) return true;
  if (value?.toString) {
    return value.toString() === id;
  }
  return false;
};
