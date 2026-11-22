import type { Database } from "@/lib/database.types";

type PublicTables = Database["public"]["Tables"];
export type Row<T extends keyof PublicTables> = PublicTables[T]["Row"];

export type UserProfile = Row<"users">;
export type Bubble = Row<"bubbles">;
export type Author = Pick<UserProfile, "id" | "name" | "avatar">;

export type ChatMessage = Row<"chat_messages"> & { sender: Author | null };
export type BoolaaEvent = Row<"events"> & { creator: Author | null };
export type FoodPost = Row<"food_posts"> & { user: Author | null };
export type MarketItem = Row<"market_items"> & { owner: Author | null };
export type SharedLink = Row<"shared_links"> & { user: Author | null };
export type Member = Row<"bubble_members"> & { user: Author | null };
export type JoinRequest = Row<"join_requests"> & { user: Author | null };

export const AUTHOR = "id, name, avatar";
