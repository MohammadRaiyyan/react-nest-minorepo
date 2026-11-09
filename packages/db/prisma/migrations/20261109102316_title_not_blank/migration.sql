ALTER TABLE "tasks" ADD CONSTRAINT  "title_not_blank" CHECK (length(trim("title")) > 0);
ALTER TABLE "projects" ADD CONSTRAINT  "name_not_blank" CHECK (length(trim("name")) > 0);