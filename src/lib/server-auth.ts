import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const getSessionUserId = async (): Promise<string | null> => {
  const session = await getServerSession(authOptions);
  return session?.user?.id || null;
};
