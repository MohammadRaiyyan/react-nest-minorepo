-- AlterTable
ALTER TABLE "projects" ADD COLUMN "last_task_number" INTEGER NOT NULL DEFAULT 0;

-- 1. Add the column as nullable
ALTER TABLE "tasks" ADD COLUMN "number" INTEGER;

-- 2. Backfill: number existing tasks 1, 2, 3 … per project, in creation order
UPDATE "tasks" t SET "number" = n.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn
  FROM "tasks"
) n
WHERE t.id = n.id;

UPDATE "projects" p
SET "last_task_number" = COALESCE((SELECT MAX("number") FROM "tasks" WHERE project_id = p.id), 0);

-- 3. Now every row has a value
ALTER TABLE "tasks" ALTER COLUMN "number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "tasks_project_id_number_key" ON "tasks"("project_id", "number");

