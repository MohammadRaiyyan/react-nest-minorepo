import { Outlet } from "react-router";

export function RootLayout() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Teamboard</h1>
      <Outlet />
    </main>
  );
}
