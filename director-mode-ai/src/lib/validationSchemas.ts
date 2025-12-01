import { z } from "zod";

// Auth schemas
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .max(255, "Email must be less than 255 characters"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .max(100, "Password must be less than 100 characters"),
});

export const signupSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .max(255, "Email must be less than 255 characters"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .max(100, "Password must be less than 100 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
});

// Event schemas
export const createEventSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Event name is required")
    .max(100, "Event name must be less than 100 characters"),
  eventDate: z
    .string()
    .min(1, "Event date is required")
    .refine((date) => {
      const selectedDate = new Date(date);
      return !isNaN(selectedDate.getTime());
    }, "Please enter a valid date"),
  startTime: z
    .string()
    .trim()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Please enter a valid time in HH:MM format")
    .optional()
    .or(z.literal("")),
  numCourts: z
    .number()
    .min(1, "Must have at least 1 court")
    .max(50, "Cannot exceed 50 courts")
    .int("Number of courts must be a whole number"),
  scoringFormat: z.enum(["timed", "fixed_games", "first_to_x", "pro_set", "best_of_3_sets", "best_of_3_tiebreak", "flexible"], {
    required_error: "Please select a scoring format",
  }),
  roundLengthMinutes: z
    .number()
    .min(5, "Round length must be at least 5 minutes")
    .max(180, "Round length cannot exceed 180 minutes")
    .int("Round length must be a whole number")
    .optional(),
  targetGames: z
    .number()
    .min(1, "Target games must be at least 1")
    .max(21, "Target games cannot exceed 21")
    .int("Target games must be a whole number")
    .optional(),
});

// Player schemas
export const addPlayerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Player name is required")
    .max(50, "Player name must be less than 50 characters")
    .regex(/^[a-zA-Z\s'-]+$/, "Player name can only contain letters, spaces, hyphens, and apostrophes"),
});

// Match score schemas
export const matchScoreSchema = z.object({
  team1Score: z
    .number()
    .min(0, "Score cannot be negative")
    .max(99, "Score cannot exceed 99")
    .int("Score must be a whole number"),
  team2Score: z
    .number()
    .min(0, "Score cannot be negative")
    .max(99, "Score cannot exceed 99")
    .int("Score must be a whole number"),
  tiebreakerWinner: z.number().min(1).max(2).optional(),
});

// Event format schemas
export const editEventFormatSchema = z.object({
  scoringFormat: z.enum(["timed", "fixed_games", "first_to_x", "pro_set", "best_of_3_sets", "best_of_3_tiebreak", "flexible"], {
    required_error: "Please select a scoring format",
  }),
  roundLengthMinutes: z
    .number()
    .min(5, "Round length must be at least 5 minutes")
    .max(180, "Round length cannot exceed 180 minutes")
    .int("Round length must be a whole number")
    .optional(),
  targetGames: z
    .number()
    .min(1, "Target games must be at least 1")
    .max(21, "Target games cannot exceed 21")
    .int("Target games must be a whole number")
    .optional(),
  numCourts: z
    .number()
    .min(1, "Must have at least 1 court")
    .max(50, "Cannot exceed 50 courts")
    .int("Number of courts must be a whole number"),
});

export type LoginFormData = z.infer<typeof loginSchema>;
export type SignupFormData = z.infer<typeof signupSchema>;
export type CreateEventFormData = z.infer<typeof createEventSchema>;
export type AddPlayerFormData = z.infer<typeof addPlayerSchema>;
export type MatchScoreFormData = z.infer<typeof matchScoreSchema>;
export type EditEventFormatFormData = z.infer<typeof editEventFormatSchema>;
