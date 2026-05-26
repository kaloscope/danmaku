/**
 * Edge Function: Catch-all route
 * Handles all /edge-app/api/* requests, including user CRUD and 404 fallback
 */
import { getStore } from "@edgeone/pages-blob";

const store = getStore("functions-test");
const USERS_KEY = "edge-app/data/users.json";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default async function onRequest(context) {
  const url = new URL(context.request.url);
  const method = context.request.method;
  const path = url.pathname.replace(/^\/edge-app\/api/, "");

  // POST /api/users - Create user
  if (path === "/users" && method === "POST") {
    const body = await context.request.json();
    const { name, email } = body;

    if (!name || !email) {
      return json({ error: "name and email are required" }, 400);
    }

    const data = await store.get(USERS_KEY, { type: "json" });
    const users = data || [];
    const newUser = { id: Date.now(), name, email };
    users.push(newUser);
    await store.setJSON(USERS_KEY, users);
    return json(newUser, 201);
  }

  // GET /api/users - List users
  if (path === "/users" && method === "GET") {
    const data = await store.get(USERS_KEY, { type: "json" });
    return json({ users: data || [] });
  }

  // GET /api/users/:id - Get single user
  const userMatch = path.match(/^\/users\/(\d+)$/);
  if (userMatch && method === "GET") {
    const id = userMatch[1];
    const data = await store.get(USERS_KEY, { type: "json" });
    const users = data || [];
    const user = users.find((u) => String(u.id) === id);

    if (!user) return json({ error: "User not found" }, 404);
    return json(user);
  }

  // DELETE /api/users/:id - Delete user
  if (userMatch && method === "DELETE") {
    const id = userMatch[1];
    const data = await store.get(USERS_KEY, { type: "json" });
    const users = data || [];
    const idx = users.findIndex((u) => String(u.id) === id);

    if (idx === -1) return json({ error: "User not found" }, 404);
    users.splice(idx, 1);
    await store.setJSON(USERS_KEY, users);
    return json({ message: "Deleted" });
  }

  // Fallback 404
  return json({ error: "Not Found", path: url.pathname, method }, 404);
}