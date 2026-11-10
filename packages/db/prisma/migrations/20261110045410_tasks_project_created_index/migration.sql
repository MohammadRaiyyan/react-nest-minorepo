-- CreateIndex
CREATE INDEX "tasks_project_id_created_at_id_idx" ON "tasks"("project_id", "created_at", "id");
