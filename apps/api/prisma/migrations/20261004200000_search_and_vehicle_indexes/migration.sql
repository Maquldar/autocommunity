-- Nickname prefix search for /users?q= (lower(nickname) LIKE 'q%')
CREATE INDEX "users_nickname_lower_idx" ON "users" (lower("nickname"::text) text_pattern_ops);

-- At most one primary vehicle per user (the API keeps exactly one when the user has any)
CREATE UNIQUE INDEX "vehicles_one_primary_per_user" ON "vehicles" ("user_id") WHERE "is_primary";
