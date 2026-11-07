// The API contract shared by @teamboard/api and @teamboard/web.
// One schema gives three things: runtime validation on the API, a TypeScript
// type for both apps, and form validation in React.
export * from './projects.ts';
export * from './tasks.ts';
