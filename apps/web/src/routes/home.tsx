import { useLoaderData } from "react-router";

type Health = { status: string; uptimeSeconds: number };

export async function homeLoader(): Promise<Health> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`API returned ${res.status}`);
  return res.json();
}

export function HomePage() {
  const health = useLoaderData<typeof homeLoader>();
  return (
    <p>
      API status: <strong>{health.status}</strong>, up for {health.uptimeSeconds}s
    </p>
  );
}
