export interface Task{
    id:string,
    projectId:string,
    title:string,
    description:string | null,
    status: "todo"|"in_progress"|"done",
    createdAt:Date,
    updatedAt:Date
}
export type TaskStatus = "todo"|"in_progress"|"done"