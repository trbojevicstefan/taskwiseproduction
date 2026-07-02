import { z } from "zod";
import { createUser, findUserByEmail } from "@/lib/db/users";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const { email, password, displayName } = await parseJsonBody(
      request,
      registerSchema,
      "Invalid registration data."
    );

    const existing = await findUserByEmail(email);
    if (existing) {
      return apiError(409, "email_in_use", "Email already in use.");
    }

    const user = await createUser({ email, password, displayName });

    return apiSuccess({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
    });
  } catch (error) {
    return mapApiError(error, "Failed to register user.");
  }
}

